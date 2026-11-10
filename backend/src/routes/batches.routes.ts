
import { Router } from "express";
import { supabase } from "../config/supabase";
import {
  requireAuth,
  requireRole
} from "../middleware/auth.middleware";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const router = Router();

const staffAccess = [
  requireAuth,
  requireRole("manager", "staff")
];

// GET all batches belonging to the user's cooperative
router.get("/", ...staffAccess, async (req, res) => {
  try {
    const cooperativeId = req.user!.cooperativeId;

    const { data, error } = await supabase
      .from("batches")
      .select(`
        id,
        batch_reference,
        grade,
        status,
        created_at,
        batch_deliveries (
          quantity_kg,
          delivery_id
        )
      `)
      .eq("cooperative_id", cooperativeId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Batches query failed:", error.message);

      return res.status(500).json({
        success: false,
        message: "Could not retrieve batches."
      });
    }

    const batches = (data ?? []).map(batch => {
      const deliveredQuantityKg = (
        batch.batch_deliveries ?? []
      ).reduce(
        (sum, delivery) => sum + Number(delivery.quantity_kg),
        0
      );

      return {
        id: batch.id,
        batchReference: batch.batch_reference,
        grade: batch.grade,
        status: batch.status,
        deliveredQuantityKg,
        deliveryCount: batch.batch_deliveries?.length ?? 0,
        createdAt: batch.created_at
      };
    });

    return res.status(200).json({
      success: true,
      count: batches.length,
      data: batches
    });

  } catch (error) {
    console.error("Batches API error:", error);

    return res.status(500).json({
      success: false,
      message: "Unexpected error retrieving batches."
    });
  }
});

// GET one batch by ID within the user's cooperative
router.get("/:id", ...staffAccess, async (req, res) => {
  try {
    const id = req.params.id;
    const cooperativeId = req.user!.cooperativeId;

    const uuidPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    if (typeof id !== "string" || !uuidPattern.test(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid batch ID."
      });
    }

    const { data, error } = await supabase
      .from("batches")
      .select(`
        id,
        cooperative_id,
        batch_reference,
        grade,
        status,
        created_at,
        batch_deliveries (
          id,
          delivery_id,
          quantity_kg,
          assigned_at
        )
      `)
      .eq("id", id)
      .eq("cooperative_id", cooperativeId)
      .maybeSingle();

    if (error) {
      console.error("Batch lookup failed:", error.message);

      return res.status(500).json({
        success: false,
        message: "Could not retrieve batch."
      });
    }

    if (!data) {
      return res.status(404).json({
        success: false,
        message: "Batch not found."
      });
    }

    const deliveredQuantityKg = (
      data.batch_deliveries ?? []
    ).reduce(
      (sum, delivery) => sum + Number(delivery.quantity_kg),
      0
    );

    return res.status(200).json({
      success: true,
      data: {
        ...data,
        deliveredQuantityKg,
        deliveryCount: data.batch_deliveries?.length ?? 0
      }
    });

  } catch (error) {
    console.error("Batch lookup error:", error);

    return res.status(500).json({
      success: false,
      message: "Unexpected error retrieving batch."
    });
  }
});


router.post("/", ...staffAccess, async (req, res) => {
  try {
    const cooperativeId = req.user!.cooperativeId;
    const actorId = req.user!.id;

    const { batchReference, grade, deliveries } = req.body;

    if (
      typeof batchReference !== "string" ||
      !batchReference.trim() ||
      !["A", "B", "C"].includes(grade) ||
      !Array.isArray(deliveries) ||
      deliveries.length === 0
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid batch information."
      });
    }

    const deliveryIds = deliveries.map(
      (item: { deliveryId?: string }) => item.deliveryId
    );

    if (
      deliveryIds.some(
        (id: unknown) =>
          typeof id !== "string" || !uuidPattern.test(id)
      ) ||
      new Set(deliveryIds).size !== deliveryIds.length ||
      deliveries.some(
        (item: { quantityKg?: number }) =>
          typeof item.quantityKg !== "number" ||
          !Number.isFinite(item.quantityKg) ||
          item.quantityKg <= 0
      )
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid or duplicate delivery assignments."
      });
    }

    // Fetch deliveries belonging to this cooperative.
    const { data: existingDeliveries, error: deliveryError } =
      await supabase
        .from("deliveries")
        .select("id, quantity_kg, grade, status")
        .eq("cooperative_id", cooperativeId)
        .in("id", deliveryIds);

    if (deliveryError) throw deliveryError;

    if (existingDeliveries?.length !== deliveries.length) {
      return res.status(400).json({
        success: false,
        message: "One or more deliveries were not found."
      });
    }

    // Validate grade and delivery status.
    for (const delivery of existingDeliveries) {
      if (delivery.grade !== grade || delivery.status !== "recorded") {
        return res.status(400).json({
          success: false,
          message: "All deliveries must be recorded and match the batch grade."
        });
      }
    }

    // Check previously assigned quantities.
    const { data: previousAssignments, error: assignmentError } =
      await supabase
        .from("batch_deliveries")
        .select("delivery_id, quantity_kg")
        .in("delivery_id", deliveryIds);

    if (assignmentError) throw assignmentError;

    for (const delivery of existingDeliveries) {
      const previouslyAssigned = (previousAssignments ?? [])
        .filter(item => item.delivery_id === delivery.id)
        .reduce(
          (sum, item) => sum + Number(item.quantity_kg),
          0
        );

      const newAssignment = deliveries.find(
        (item: { deliveryId: string }) =>
          item.deliveryId === delivery.id
      );

      if (
        previouslyAssigned + newAssignment.quantityKg >
        Number(delivery.quantity_kg)
      ) {
        return res.status(400).json({
          success: false,
          message: `Assignment exceeds available quantity for delivery ${delivery.id}.`
        });
      }
    }

    // Create the batch.
    const { data: batch, error: batchError } = await supabase
      .from("batches")
      .insert({
        cooperative_id: cooperativeId,
        batch_reference: batchReference.trim(),
        grade,
        status: "open",
        created_by: actorId
      })
      .select()
      .single();

    if (batchError) throw batchError;

    // Assign deliveries to the batch.
    const assignmentRows = deliveries.map(
      (item: { deliveryId: string; quantityKg: number }) => ({
        batch_id: batch.id,
        delivery_id: item.deliveryId,
        quantity_kg: item.quantityKg,
        assigned_by: actorId
      })
    );

    const { error: insertError } = await supabase
      .from("batch_deliveries")
      .insert(assignmentRows);

    if (insertError) {
      // Remove the empty batch if assignment insertion fails.
      await supabase
        .from("batches")
        .delete()
        .eq("id", batch.id)
        .eq("cooperative_id", cooperativeId);

      throw insertError;
    }

    // Record the batch creation in audit history.
    const { error: auditError } = await supabase
      .from("audit_events")
      .insert({
        cooperative_id: cooperativeId,
        actor_id: actorId,
        entity_type: "batch",
        entity_id: batch.id,
        event_type: "batch_created",
        new_values: {
          batch_reference: batch.batch_reference,
          grade: batch.grade,
          deliveries: assignmentRows
        },
        reason: "Initial batch creation"
      });

    if (auditError) {
      console.error("Batch audit event failed:", auditError.message);

      return res.status(500).json({
        success: false,
        message: "Batch was created, but its audit event failed. Do not create it again.",
        data: batch
      });
    }

    return res.status(201).json({
      success: true,
      message: "Batch created successfully.",
      data: {
        ...batch,
        assignments: assignmentRows
      }
    });

  } catch (error) {
    console.error("Batch creation error:", error);

    return res.status(500).json({
      success: false,
      message: "Could not create batch."
    });
  }
});


router.post("/", ...staffAccess, async (req, res) => {
  try {
    const cooperativeId = req.user!.cooperativeId;
    const actorId = req.user!.id;

    const { batchReference, grade, deliveries } = req.body;

    if (
      typeof batchReference !== "string" ||
      !batchReference.trim() ||
      !["A", "B", "C"].includes(grade) ||
      !Array.isArray(deliveries) ||
      deliveries.length === 0
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid batch information."
      });
    }

    const deliveryIds = deliveries.map(
      (item: { deliveryId?: string }) => item.deliveryId
    );

    if (
      deliveryIds.some(
        (id: unknown) =>
          typeof id !== "string" || !uuidPattern.test(id)
      ) ||
      new Set(deliveryIds).size !== deliveryIds.length ||
      deliveries.some(
        (item: { quantityKg?: number }) =>
          typeof item.quantityKg !== "number" ||
          !Number.isFinite(item.quantityKg) ||
          item.quantityKg <= 0
      )
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid or duplicate delivery assignments."
      });
    }

    // Verify all deliveries belong to this cooperative.
    const { data: existingDeliveries, error: deliveryError } =
      await supabase
        .from("deliveries")
        .select("id, quantity_kg, grade, status")
        .eq("cooperative_id", cooperativeId)
        .in("id", deliveryIds);

    if (deliveryError) throw deliveryError;

    if (existingDeliveries?.length !== deliveries.length) {
      return res.status(400).json({
        success: false,
        message: "One or more deliveries were not found."
      });
    }

    // Validate quantities and grade.
    for (const assignment of deliveries) {
      const delivery = existingDeliveries.find(
        item => item.id === assignment.deliveryId
      );

      if (
        !delivery ||
        delivery.status !== "recorded" ||
        delivery.grade !== grade
      ) {
        return res.status(400).json({
          success: false,
          message: "All deliveries must be recorded and match the batch grade."
        });
      }

      const { data: previousAssignments, error: previousError } =
        await supabase
          .from("batch_deliveries")
          .select("quantity_kg")
          .eq("delivery_id", assignment.deliveryId);

      if (previousError) throw previousError;

      const alreadyAssigned = (previousAssignments ?? []).reduce(
        (sum, item) => sum + Number(item.quantity_kg),
        0
      );

      if (
        alreadyAssigned + assignment.quantityKg >
        Number(delivery.quantity_kg)
      ) {
        return res.status(400).json({
          success: false,
          message: `Assignment exceeds available quantity for delivery ${assignment.deliveryId}.`
        });
      }
    }

    // Create batch.
    const { data: batch, error: batchError } = await supabase
      .from("batches")
      .insert({
        cooperative_id: cooperativeId,
        batch_reference: batchReference.trim(),
        grade,
        status: "open",
        created_by: actorId
      })
      .select()
      .single();

    if (batchError) throw batchError;

    // Link deliveries to the batch.
    const assignments = deliveries.map(
      (item: { deliveryId: string; quantityKg: number }) => ({
        batch_id: batch.id,
        delivery_id: item.deliveryId,
        quantity_kg: item.quantityKg,
        assigned_by: actorId
      })
    );

    const { error: assignmentError } = await supabase
      .from("batch_deliveries")
      .insert(assignments);

    if (assignmentError) {
      console.error("Batch assignment failed:", assignmentError.message);

      return res.status(500).json({
        success: false,
        message: "Batch created, but delivery assignment failed. Do not retry with the same batch reference.",
        data: { batch }
      });
    }

    // Create audit event.
    const { error: auditError } = await supabase
      .from("audit_events")
      .insert({
        cooperative_id: cooperativeId,
        actor_id: actorId,
        entity_type: "batch",
        entity_id: batch.id,
        event_type: "batch_created",
        new_values: {
          batch_reference: batch.batch_reference,
          grade,
          deliveries: assignments
        },
        reason: "Initial batch creation"
      });

    if (auditError) {
      console.error("Batch audit failed:", auditError.message);

      return res.status(500).json({
        success: false,
        message: "Batch was created, but its audit event failed.",
        data: { batch }
      });
    }

    return res.status(201).json({
      success: true,
      message: "Batch created successfully.",
      data: batch
    });

  } catch (error) {
    console.error("Batch creation error:", error);

    return res.status(500).json({
      success: false,
      message: "Could not create batch."
    });
  }
});


export default router;
