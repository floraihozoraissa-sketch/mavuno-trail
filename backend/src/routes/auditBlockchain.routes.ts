
import { Router, Request, Response } from "express";
import {
  Interface,
  JsonRpcProvider,
  getAddress,
  keccak256,
  toUtf8Bytes
} from "ethers";
import { supabase } from "../config/supabase";
import { requireAuth, requireRole } from "../middleware/auth.middleware";

const router = Router();

router.get("/events", requireAuth, requireRole("manager", "staff", "farmer"), async (req, res) => {
  try {
    let query = supabase
      .from("audit_events")
      .select("id, entity_type, entity_id, event_type, recorded_at, audit_event_anchors(id, transaction_hash, blockchain_network, block_number, contract_address)")
      .eq("cooperative_id", req.user!.cooperativeId)
      .order("recorded_at", { ascending: false })
      .limit(100);

    // Farmers can only see audit events for their own deliveries
    if (req.user!.role === "farmer") {
      const { data: farmerDeliveries } = await supabase
        .from("deliveries")
        .select("id")
        .eq("farmer_id", req.user!.id)
        .eq("cooperative_id", req.user!.cooperativeId);
      
      const deliveryIds = (farmerDeliveries ?? []).map(d => d.id);
      if (deliveryIds.length > 0) {
        query = query.in("entity_id", deliveryIds).eq("entity_type", "delivery");
      } else {
        return res.json({ success: true, data: [] });
      }
    }

    const { data, error } = await query;
    if (error) throw error;
    return res.json({ success: true, data: data ?? [] });
  } catch (error) {
    console.error("Audit event listing failed:", error);
    return res.status(500).json({ success: false, message: "Could not load audit history." });
  }
});

const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;
const RPC_URL =
  process.env.SEPOLIA_RPC_URL ||
  "https://ethereum-sepolia-rpc.publicnode.com";

const contractInterface = new Interface([
  "event AuditEventAnchored(bytes32 indexed eventHash, string eventType, address indexed recorder, uint256 timestamp)"
]);

const provider = new JsonRpcProvider(RPC_URL);

function stableStringify(value: any): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }

  const keys = Object.keys(value).sort();

  return `{${keys
    .map(
      (key) =>
        `${JSON.stringify(key)}:${stableStringify(value[key])}`
    )
    .join(",")}}`;
}

function calculateAuditHash(event: any): string {
  const canonicalEvent = {
    id: event.id,
    cooperative_id: event.cooperative_id,
    actor_id: event.actor_id,
    entity_type: event.entity_type,
    entity_id: event.entity_id,
    event_type: event.event_type,
    previous_values: event.previous_values,
    new_values: event.new_values,
    reason: event.reason,
    recorded_at: new Date(event.recorded_at).toISOString()
  };

  return keccak256(toUtf8Bytes(stableStringify(canonicalEvent)));
}

async function getAuditEvent(auditEventId: string, cooperativeId: string) {
  const { data, error } = await supabase
    .from("audit_events")
    .select(`
      id,
      cooperative_id,
      actor_id,
      entity_type,
      entity_id,
      event_type,
      previous_values,
      new_values,
      reason,
      recorded_at
    `)
    .eq("id", auditEventId)
    .eq("cooperative_id", cooperativeId)
    .maybeSingle();

  if (error) throw error;

  return data;
}

// Prepare an audit event for MetaMask anchoring.
router.get(
  "/:auditEventId/hash",
  requireAuth,
  requireRole("manager", "staff"),
  async (req: Request, res: Response) => {
    try {
      const event = await getAuditEvent(
        String(req.params.auditEventId),
        req.user!.cooperativeId
      );

      if (!event) {
        return res.status(404).json({
          success: false,
          message: "Audit event not found."
        });
      }

      const { data: existingAnchor, error: anchorError } =
        await supabase
          .from("audit_event_anchors")
          .select("id")
          .eq("audit_event_id", event.id)
          .maybeSingle();

      if (anchorError) throw anchorError;

      if (existingAnchor) {
        return res.status(409).json({
          success: false,
          message: "This audit event has already been anchored."
        });
      }

      return res.status(200).json({
        success: true,
        data: {
          auditEventId: event.id,
          eventType: event.event_type,
          eventHash: calculateAuditHash(event),
          contractAddress: CONTRACT_ADDRESS,
          network: "sepolia"
        }
      });
    } catch (error) {
      console.error("Audit hash preparation failed:", error);

      return res.status(500).json({
        success: false,
        message: "Could not prepare the audit event."
      });
    }
  }
);

// Verify a MetaMask transaction independently before saving its proof.
router.post(
  "/:auditEventId/confirm",
  requireAuth,
  requireRole("manager", "staff"),
  async (req: Request, res: Response) => {
    try {
      if (!CONTRACT_ADDRESS) {
        return res.status(500).json({
          success: false,
          message: "Contract address is not configured."
        });
      }

      const transactionHash = req.body?.transactionHash;

      if (
        typeof transactionHash !== "string" ||
        !/^0x[0-9a-fA-F]{64}$/.test(transactionHash)
      ) {
        return res.status(400).json({
          success: false,
          message: "A valid transaction hash is required."
        });
      }

      const event = await getAuditEvent(
        String(req.params.auditEventId),
        req.user!.cooperativeId
      );

      if (!event) {
        return res.status(404).json({
          success: false,
          message: "Audit event not found."
        });
      }

      const eventHash = calculateAuditHash(event);
      const expectedAddress = getAddress(CONTRACT_ADDRESS);

      const network = await provider.getNetwork();

      if (network.chainId !== 11155111n) {
        return res.status(503).json({
          success: false,
          message: "The configured RPC is not connected to Sepolia."
        });
      }

      const receipt = await provider.getTransactionReceipt(
        transactionHash
      );

      if (!receipt) {
        return res.status(409).json({
          success: false,
          message: "Transaction is not confirmed yet."
        });
      }

      if (receipt.status !== 1) {
        return res.status(400).json({
          success: false,
          message: "Blockchain transaction failed."
        });
      }

      if (
        !receipt.to ||
        getAddress(receipt.to) !== expectedAddress
      ) {
        return res.status(400).json({
          success: false,
          message: "Transaction was not sent to the MavunoTrail contract."
        });
      }

      const matchingLog = receipt.logs
        .filter(
          (log) =>
            getAddress(log.address) === expectedAddress
        )
        .map((log) => {
          try {
            return contractInterface.parseLog(log);
          } catch {
            return null;
          }
        })
        .find(
          (parsed) =>
            parsed?.name === "AuditEventAnchored" &&
            String(parsed.args.eventHash).toLowerCase() ===
              eventHash.toLowerCase() &&
            parsed.args.eventType === event.event_type
        );

      if (!matchingLog) {
        return res.status(400).json({
          success: false,
          message: "Transaction does not contain the expected audit event."
        });
      }

      const { data: anchor, error: insertError } = await supabase
        .from("audit_event_anchors")
        .insert({
          audit_event_id: event.id,
          event_hash: eventHash,
          blockchain_network: "sepolia",
          contract_address: expectedAddress,
          transaction_hash: receipt.hash,
          block_number: receipt.blockNumber
        })
        .select()
        .single();

      if (insertError) {
        if (insertError.code === "23505") {
          return res.status(409).json({
            success: false,
            message: "This event or transaction already has an anchor."
          });
        }

        throw insertError;
      }

      return res.status(201).json({
        success: true,
        message: "Blockchain proof verified and saved.",
        data: anchor
      });
    } catch (error) {
      console.error("Blockchain proof verification failed:", error);

      return res.status(500).json({
        success: false,
        message: "Could not verify the blockchain proof."
      });
    }
  }
);

export default router;
