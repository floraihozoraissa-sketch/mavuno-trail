
import { Router, Request, Response } from "express";
import { supabase } from "../config/supabase";
import {
  requireAuth,
  requireRole
} from "../middleware/auth.middleware";

const router = Router();

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const staffAccess = [
  requireAuth,
  requireRole("manager", "staff")
];

const farmerAccess = [
  requireAuth,
  requireRole("manager", "staff", "farmer")
];

// GET all deliveries belonging to the cooperative.
// Farmers can only see their own deliveries.
router.get("/", ...farmerAccess, async (req, res) => {
  try {
    const { farmerId } = req.query;

    let query = supabase
      .from("deliveries")
      .select("*, batch_deliveries(quantity_kg)")
      .eq("cooperative_id", req.user!.cooperativeId)
      .order("created_at", { ascending: false });

    // Farmers can only see their own deliveries
    if (req.user!.role === "farmer") {
  query = query.eq("farmer_id", req.user!.farmerId!);
} else if (farmerId !== undefined) {
      if (
        typeof farmerId !== "string" ||
        !uuidPattern.test(farmerId)
      ) {
        return res.status(400).json({
          success: false,
          message: "Invalid farmer ID."
        });
      }

      query = query.eq("farmer_id", farmerId);
    }

    const { data, error } = await query;

    if (error) throw error;

    const deliveries = (data ?? []).map(delivery => {
      const assigned = (delivery.batch_deliveries ?? []).reduce(
        (sum: number, row: { quantity_kg: number }) => sum + Number(row.quantity_kg),
        0
      );
      return {
        ...delivery,
        availableQuantityKg: Math.max(0, Number(delivery.quantity_kg) - assigned)
      };
    });

    return res.status(200).json({
      success: true,
      data: deliveries
    });

  } catch (error) {
    console.error("Fetch deliveries error:", error);

    return res.status(500).json({
      success: false,
      message: "Could not load deliveries."
    });
  }
});

// GET one delivery.
router.get("/:id", ...farmerAccess, async (req, res) => {
  try {
    const { id } = req.params;

    if (typeof id !== "string" || !uuidPattern.test(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid delivery ID."
      });
    }

    let query = supabase
      .from("deliveries")
      .select("*")
      .eq("id", id)
      .eq("cooperative_id", req.user!.cooperativeId);

    // Farmers can only see their own deliveries
   if (req.user!.role === "farmer") {
  query = query.eq("farmer_id", req.user!.farmerId!);
}

    const { data, error } = await query.maybeSingle();

    if (error) throw error;

    if (!data) {
      return res.status(404).json({
        success: false,
        message: "Delivery not found."
      });
    }

    return res.status(200).json({
      success: true,
      data
    });

  } catch (error) {
    console.error("Fetch delivery error:", error);

    return res.status(500).json({
      success: false,
      message: "Could not load delivery."
    });
  }
});

// POST record a new delivery.
router.post("/", ...staffAccess, async (req, res) => {
  try {
    const cooperativeId = req.user!.cooperativeId;
    const actorId = req.user!.id;

    const {
      farmerId,
      collectionCentreId,
      deliveryReference,
      quantityKg,
      grade,
      deliveredAt,
      notes
    } = req.body;

    // Validate delivery information.
    if (
      typeof farmerId !== "string" ||
      !uuidPattern.test(farmerId) ||
      typeof collectionCentreId !== "string" ||
      !uuidPattern.test(collectionCentreId) ||
      typeof deliveryReference !== "string" ||
      !deliveryReference.trim() ||
      typeof quantityKg !== "number" ||
      !Number.isFinite(quantityKg) ||
      quantityKg <= 0 ||
      !["A", "B", "C"].includes(grade) ||
      typeof deliveredAt !== "string" ||
      Number.isNaN(Date.parse(deliveredAt))
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid or missing delivery information."
      });
    }

    // Confirm the farmer belongs to this cooperative.
    const { data: farmer, error: farmerError } = await supabase
      .from("farmers")
      .select("id")
      .eq("id", farmerId)
      .eq("cooperative_id", cooperativeId)
      .eq("status", "active")
      .maybeSingle();

    if (farmerError) throw farmerError;

    if (!farmer) {
      return res.status(404).json({
        success: false,
        message: "Farmer not found in this cooperative."
      });
    }

    // Confirm the collection centre belongs to this cooperative.
    const { data: centre, error: centreError } = await supabase
      .from("collection_centres")
      .select("id")
      .eq("id", collectionCentreId)
      .eq("cooperative_id", cooperativeId)
      .eq("status", "active")
      .maybeSingle();

    if (centreError) throw centreError;

    if (!centre) {
      return res.status(404).json({
        success: false,
        message: "Collection centre not found in this cooperative."
      });
    }

    // Save the delivery.
    const { data: delivery, error: deliveryError } = await supabase
      .from("deliveries")
      .insert({
        cooperative_id: cooperativeId,
        farmer_id: farmerId,
        collection_centre_id: collectionCentreId,
        delivery_reference: deliveryReference.trim(),
        quantity_kg: quantityKg,
        grade,
        delivered_at: deliveredAt,
        notes: typeof notes === "string" ? notes.trim() || null : null,
        recorded_by: actorId,
        status: "recorded"
      })
      .select()
      .single();

    if (deliveryError) throw deliveryError;

    // Record the creation in the audit history.
    const { error: auditError } = await supabase
      .from("audit_events")
      .insert({
        cooperative_id: cooperativeId,
        actor_id: actorId,
        entity_type: "delivery",
        entity_id: delivery.id,
        event_type: "delivery_recorded",
        previous_values: null,
        new_values: {
          delivery_reference: delivery.delivery_reference,
          farmer_id: delivery.farmer_id,
          quantity_kg: delivery.quantity_kg,
          grade: delivery.grade,
          status: delivery.status
        },
        reason: "Initial delivery record"
      });

    if (auditError) {
      console.error("Delivery audit event failed:", auditError.message);

      return res.status(500).json({
        success: false,
        message: "Delivery was saved, but its audit event failed. Do not submit it again.",
        data: { delivery }
      });
    }

    return res.status(201).json({
      success: true,
      message: "Delivery recorded successfully.",
      data: delivery
    });

  } catch (error) {
    console.error("Delivery creation error:", error);

    return res.status(500).json({
      success: false,
      message: "Could not record delivery."
    });
  }
});


async function submitFarmerResponse(
  req: Request,
  res: Response,
  response: "confirmed" | "disputed"
) {
  try {
    const { id } = req.params;

    if (typeof id !== "string" || !uuidPattern.test(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid delivery ID."
      });
    }

    const note =
      typeof req.body?.note === "string"
        ? req.body.note.trim()
        : null;

    if (note && note.length > 1000) {
      return res.status(400).json({
        success: false,
        message: "Your response note must not exceed 1000 characters."
      });
    }

    if (response === "disputed" && !note) {
      return res.status(400).json({
        success: false,
        message: "Please explain why you are disputing this delivery."
      });
    }

    const { data, error } = await supabase.rpc(
  "respond_to_delivery",
  {
    p_delivery_id: id,
    p_farmer_id: req.user!.farmerId!,
    p_actor_id: req.user!.id,
    p_cooperative_id: req.user!.cooperativeId,
    p_response: response,
    p_note: note
  }
);

    if (error) {
      console.error("Farmer delivery response failed:", error);

      const message = error.message || "";

      if (message.includes("DELIVERY_NOT_FOUND")) {
        return res.status(404).json({
          success: false,
          message: "Delivery not found."
        });
      }

      if (message.includes("RESPONSE_ALREADY_SUBMITTED")) {
        return res.status(409).json({
          success: false,
          message: "You have already responded to this delivery."
        });
      }

      if (message.includes("DELIVERY_CANCELLED")) {
        return res.status(409).json({
          success: false,
          message: "A cancelled delivery cannot receive a response."
        });
      }

      if (message.includes("DISPUTE_REASON_REQUIRED")) {
        return res.status(400).json({
          success: false,
          message: "A dispute reason is required."
        });
      }

      return res.status(500).json({
        success: false,
        message: "Could not submit your delivery response."
      });
    }

    return res.status(200).json({
      success: true,
      message:
        response === "confirmed"
          ? "Delivery confirmed successfully."
          : "Delivery dispute submitted successfully.",
      data
    });

  } catch (error) {
    console.error("Farmer response error:", error);

    return res.status(500).json({
      success: false,
      message: "Could not submit your delivery response."
    });
  }
}

// Farmer confirms their delivery.
router.post(
  "/:id/confirm",
  requireAuth,
  requireRole("farmer"),
  async (req: Request, res: Response) => {
    return submitFarmerResponse(req, res, "confirmed");
  }
);

// Farmer disputes their delivery.
router.post(
  "/:id/dispute",
  requireAuth,
  requireRole("farmer"),
  async (req: Request, res: Response) => {
    return submitFarmerResponse(req, res, "disputed");
  }
);


export default router;
