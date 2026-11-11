
import { Router, Request, Response } from "express";
import { supabase } from "../config/supabase";
import {
  requireAuth,
  requireRole,
} from "../middleware/auth.middleware";

const router = Router();

const staffAccess = [
  requireAuth,
  requireRole("manager", "staff"),
];

const managerAccess = [
  requireAuth,
  requireRole("manager"),
];

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const proposalStatuses = [
  "pending",
  "approved",
  "rejected",
  "expired",
  "applied",
  "cancelled",
];

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_REGEX.test(value);
}

function getActor(req: Request) {
  return {
    actorId: req.user!.id,
    cooperativeId: req.user!.cooperativeId,
  };
}

function sendDatabaseError(
  res: Response,
  error: { code?: string; message?: string }
) {
  // PostgreSQL business-rule exceptions raised by our RPC functions.
  if (error.code === "P0001" || error.code === "23505") {
    return res.status(400).json({
      success: false,
      message: error.message || "The request could not be completed.",
    });
  }

  console.error("Governance database error:", error);

  return res.status(500).json({
    success: false,
    message: "A server error occurred while processing the governance request.",
  });
}

/* =========================================================
   APPROVER MANAGEMENT
   ========================================================= */

// GET /api/governance/approvers
// Lists designated approvers for the authenticated user's cooperative.
router.get("/approvers", ...staffAccess, async (req, res) => {
  try {
    const { cooperativeId } = getActor(req);

    const status = req.query.status;

    let query = supabase
      .from("cooperative_approvers")
      .select(
        "id, user_id, assigned_by, status, assigned_at, revoked_by, revoked_at"
      )
      .eq("cooperative_id", cooperativeId)
      .order("assigned_at", { ascending: false });

    if (status === "active" || status === "revoked") {
      query = query.eq("status", status);
    }

    const { data, error } = await query;

    if (error) {
      return sendDatabaseError(res, error);
    }

    return res.json({
      success: true,
      approvers: data || [],
    });
  } catch (error) {
    console.error("List approvers error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to retrieve cooperative approvers.",
    });
  }
});

// POST /api/governance/approvers
// Only an authenticated cooperative manager can assign an approver.
router.post("/approvers", ...managerAccess, async (req, res) => {
  try {
    const { actorId, cooperativeId } = getActor(req);
    const { userId } = req.body;

    if (!isUuid(userId)) {
      return res.status(400).json({
        success: false,
        message: "A valid userId is required.",
      });
    }

    const { data, error } = await supabase.rpc(
      "assign_cooperative_approver",
      {
        p_cooperative_id: cooperativeId,
        p_actor_id: actorId,
        p_user_id: userId,
      }
    );

    if (error) {
      return sendDatabaseError(res, error);
    }

    return res.status(201).json(data);
  } catch (error) {
    console.error("Assign approver error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to assign the cooperative approver.",
    });
  }
});

// DELETE /api/governance/approvers/:userId
// Only an authenticated cooperative manager can revoke an approver.
router.delete(
  "/approvers/:userId",
  ...managerAccess,
  async (req, res) => {
    try {
      const { actorId, cooperativeId } = getActor(req);
      const { userId } = req.params;

      if (!isUuid(userId)) {
        return res.status(400).json({
          success: false,
          message: "A valid user ID is required.",
        });
      }

      const { data, error } = await supabase.rpc(
        "revoke_cooperative_approver",
        {
          p_cooperative_id: cooperativeId,
          p_actor_id: actorId,
          p_user_id: userId,
        }
      );

      if (error) {
        return sendDatabaseError(res, error);
      }

      return res.json(data);
    } catch (error) {
      console.error("Revoke approver error:", error);

      return res.status(500).json({
        success: false,
        message: "Unable to revoke the cooperative approver.",
      });
    }
  }
);

/* =========================================================
   GOVERNANCE PROPOSALS
   ========================================================= */

// POST /api/governance/proposals
// An active manager or staff member can submit a proposal.
router.post("/proposals", ...staffAccess, async (req, res) => {
  try {
    const { actorId, cooperativeId } = getActor(req);

    const {
      proposalType,
      entityType,
      entityId,
      title,
      description,
      payload,
      expiresAt,
    } = req.body;

    if (
      !["sale", "correction"].includes(proposalType) ||
      ![
        "batch",
        "delivery",
        "sale",
        "payment_record",
        "farmer_allocation",
      ].includes(entityType) ||
      !isUuid(entityId) ||
      typeof title !== "string" ||
      title.trim().length === 0 ||
      title.trim().length > 160 ||
      (description !== undefined &&
        description !== null &&
        (typeof description !== "string" ||
          description.length > 2000)) ||
      payload === null ||
      typeof payload !== "object" ||
      Array.isArray(payload) ||
      typeof expiresAt !== "string" ||
      Number.isNaN(Date.parse(expiresAt))
    ) {
      return res.status(400).json({
        success: false,
        message: "The proposal details are missing or invalid.",
      });
    }

    const { data, error } = await supabase.rpc(
      "create_governance_proposal",
      {
        p_cooperative_id: cooperativeId,
        p_actor_id: actorId,
        p_proposal_type: proposalType,
        p_entity_type: entityType,
        p_entity_id: entityId,
        p_title: title.trim(),
        p_description: description?.trim() || null,
        p_payload: payload,
        p_expires_at: expiresAt,
      }
    );

    if (error) {
      return sendDatabaseError(res, error);
    }

    return res.status(201).json(data);
  } catch (error) {
    console.error("Create proposal error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to create the governance proposal.",
    });
  }
});

// GET /api/governance/proposals
// Lists proposals belonging only to the authenticated user's cooperative.
router.get("/proposals", ...staffAccess, async (req, res) => {
  try {
    const { cooperativeId } = getActor(req);

    const status =
      typeof req.query.status === "string"
        ? req.query.status
        : undefined;

    if (status && !proposalStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid proposal status.",
      });
    }

    const requestedLimit = Number(req.query.limit || 50);
    const limit = Number.isInteger(requestedLimit)
      ? Math.min(Math.max(requestedLimit, 1), 100)
      : 50;

    let query = supabase
      .from("governance_proposals")
      .select("*")
      .eq("cooperative_id", cooperativeId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (status) {
      query = query.eq("status", status);
    }

    const { data, error } = await query;

    if (error) {
      return sendDatabaseError(res, error);
    }

    return res.json({
      success: true,
      proposals: data || [],
    });
  } catch (error) {
    console.error("List proposals error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to retrieve governance proposals.",
    });
  }
});

// GET /api/governance/proposals/:proposalId
// Retrieves one proposal and its recorded votes.
router.get(
  "/proposals/:proposalId",
  ...staffAccess,
  async (req, res) => {
    try {
      const { cooperativeId } = getActor(req);
      const { proposalId } = req.params;

      if (!isUuid(proposalId)) {
        return res.status(400).json({
          success: false,
          message: "A valid proposal ID is required.",
        });
      }

      const { data: proposal, error: proposalError } = await supabase
        .from("governance_proposals")
        .select("*")
        .eq("id", proposalId)
        .eq("cooperative_id", cooperativeId)
        .maybeSingle();

      if (proposalError) {
        return sendDatabaseError(res, proposalError);
      }

      if (!proposal) {
        return res.status(404).json({
          success: false,
          message: "Proposal not found.",
        });
      }

      const { data: approvals, error: approvalsError } = await supabase
        .from("proposal_approvals")
        .select(
          "id, approver_user_id, proposal_version, decision, comment, created_at"
        )
        .eq("proposal_id", proposalId)
        .eq("cooperative_id", cooperativeId)
        .order("created_at", { ascending: true });

      if (approvalsError) {
        return sendDatabaseError(res, approvalsError);
      }

      return res.json({
        success: true,
        proposal,
        approvals: approvals || [],
      });
    } catch (error) {
      console.error("Get proposal error:", error);

      return res.status(500).json({
        success: false,
        message: "Unable to retrieve the governance proposal.",
      });
    }
  }
);

// POST /api/governance/proposals/:proposalId/votes
// An active, eligible cooperative approver can approve or reject.
router.post(
  "/proposals/:proposalId/votes",
  ...staffAccess,
  async (req, res) => {
    try {
      const { actorId } = getActor(req);
      const { proposalId } = req.params;
      const { decision, comment } = req.body;

      if (!isUuid(proposalId)) {
        return res.status(400).json({
          success: false,
          message: "A valid proposal ID is required.",
        });
      }

      if (!["approve", "reject"].includes(decision)) {
        return res.status(400).json({
          success: false,
          message: "Decision must be approve or reject.",
        });
      }

      if (
        comment !== undefined &&
        comment !== null &&
        (typeof comment !== "string" || comment.length > 1000)
      ) {
        return res.status(400).json({
          success: false,
          message: "Comment must be 1000 characters or fewer.",
        });
      }

      const { data, error } = await supabase.rpc(
        "cast_governance_vote",
        {
          p_proposal_id: proposalId,
          p_actor_id: actorId,
          p_decision: decision,
          p_comment: comment?.trim() || null,
        }
      );

      if (error) {
        return sendDatabaseError(res, error);
      }

      return res.json(data);
    } catch (error) {
      console.error("Cast governance vote error:", error);

      return res.status(500).json({
        success: false,
        message: "Unable to record the governance vote.",
      });
    }
  }
);

export default router;
