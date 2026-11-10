import { Router } from "express";
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

// GET all payment records
router.get("/", ...staffAccess, async (req, res) => {
  try {
    const { data: sales, error: salesError } = await supabase.from("sales").select("id").eq("cooperative_id", req.user!.cooperativeId);
    if (salesError) throw salesError;
    const saleIds = (sales ?? []).map(item => item.id);
    const { data: saleItems, error: itemsError } = saleIds.length ? await supabase.from("sale_batch_items").select("id").in("sale_id", saleIds) : { data: [], error: null };
    if (itemsError) throw itemsError;
    const itemIds = (saleItems ?? []).map(item => item.id);
    const { data: allocations, error: allocationsError } = itemIds.length ? await supabase.from("farmer_allocations").select("id").in("sale_batch_item_id", itemIds) : { data: [], error: null };
    if (allocationsError) throw allocationsError;
    const allocationIds = (allocations ?? []).map(item => item.id);
    if (!allocationIds.length) return res.json({ success: true, count: 0, data: [] });
    const { data, error } = await supabase
      .from("payment_records")
      .select(`
        id,
        allocation_id,
        payment_reference,
        amount_rwf,
        payment_method,
        payment_date,
        external_reference,
        status,
        notes
      `)
      .in("allocation_id", allocationIds)
      .order("payment_date", { ascending: false });

    if (error) {
      console.error("Payments query failed:", error.message);

      return res.status(500).json({
        success: false,
        message: "Could not retrieve payment records."
      });
    }

    return res.status(200).json({
      success: true,
      count: data.length,
      data
    });

  } catch (error) {
    console.error("Payments API error:", error);

    return res.status(500).json({
      success: false,
      message: "Unexpected error retrieving payments."
    });
  }
});

// GET payments for one allocation
router.get("/allocation/:allocationId", ...staffAccess, async (req, res) => {
  try {
    const allocationId = String(req.params.allocationId);

    if (!uuidPattern.test(allocationId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid allocation ID."
      });
    }

    const { data: allocation } = await supabase.from("farmer_allocations").select("sale_batch_item_id").eq("id", allocationId).maybeSingle();
    const { data: saleItem } = allocation ? await supabase.from("sale_batch_items").select("sale_id").eq("id", allocation.sale_batch_item_id).maybeSingle() : { data: null };
    const { data: sale } = saleItem ? await supabase.from("sales").select("id").eq("id", saleItem.sale_id).eq("cooperative_id", req.user!.cooperativeId).maybeSingle() : { data: null };
    if (!sale) return res.status(404).json({ success: false, message: "Allocation not found." });
    const { data, error } = await supabase
      .from("payment_records")
      .select("*")
      .eq("allocation_id", allocationId)
      .order("payment_date", { ascending: false });

    if (error) {
      console.error("Allocation payments query failed:", error.message);

      return res.status(500).json({
        success: false,
        message: "Could not retrieve allocation payments."
      });
    }

    const totalPaidRwf = (data ?? [])
      .filter(payment => payment.status === "recorded")
      .reduce(
        (sum, payment) => sum + Number(payment.amount_rwf),
        0
      );

    return res.status(200).json({
      success: true,
      count: data.length,
      totalPaidRwf,
      data
    });

  } catch (error) {
    console.error("Allocation payments error:", error);

    return res.status(500).json({
      success: false,
      message: "Unexpected error retrieving allocation payments."
    });
  }
});


router.post("/", ...staffAccess, async (req, res) => {
  try {
    const cooperativeId = req.user!.cooperativeId;
    const actorId = req.user!.id;

    const {
      allocationId,
      amountRwf,
      paymentMethod,
      paymentDate
    } = req.body;

    if (
      typeof allocationId !== "string" ||
      !uuidPattern.test(allocationId) ||
      typeof amountRwf !== "number" ||
      !Number.isSafeInteger(amountRwf) ||
      amountRwf <= 0 ||
      !["mobile_money", "bank_transfer", "cash", "other"].includes(paymentMethod) ||
      typeof paymentDate !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(paymentDate)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid payment information."
      });
    }

    const { data: allocation, error: allocationError } =
      await supabase
        .from("farmer_allocations")
        .select(`
          id,
          net_amount_rwf,
          status,
          sale_batch_item_id
        `)
        .eq("id", allocationId)
        .eq("status", "approved")
        .single();

    if (allocationError || !allocation) {
      return res.status(404).json({
        success: false,
        message: "Approved allocation not found."
      });
    }

    const { data: saleItem, error: saleItemError } =
      await supabase
        .from("sale_batch_items")
        .select("sale_id")
        .eq("id", allocation.sale_batch_item_id)
        .single();

    if (saleItemError || !saleItem) {
      return res.status(404).json({
        success: false,
        message: "Related sale item not found."
      });
    }

    const { data: sale, error: saleError } =
      await supabase
        .from("sales")
        .select("id")
        .eq("id", saleItem.sale_id)
        .eq("cooperative_id", cooperativeId)
        .single();

    if (saleError || !sale) {
      return res.status(404).json({
        success: false,
        message: "Sale not found."
      });
    }

    const { data: existingPayments, error: paymentsError } =
      await supabase
        .from("payment_records")
        .select("amount_rwf")
        .eq("allocation_id", allocationId)
        .eq("status", "recorded");

    if (paymentsError) throw paymentsError;

    const alreadyPaid = (existingPayments ?? []).reduce(
      (sum, payment) => sum + Number(payment.amount_rwf),
      0
    );

    const outstanding =
      Number(allocation.net_amount_rwf) - alreadyPaid;

    if (amountRwf > outstanding) {
      return res.status(400).json({
        success: false,
        message: "Payment exceeds the outstanding allocation balance.",
        data: { outstandingRwf: outstanding }
      });
    }

    const { data: payment, error: insertError } =
      await supabase
        .from("payment_records")
        .insert({
  allocation_id: allocationId,
  payment_reference: `DEMO-PAY-${Date.now()}`,
  amount_rwf: amountRwf,
  payment_method: paymentMethod,
  payment_date: paymentDate,
  status: "recorded",
  notes: "SIMULATION ONLY — no real money was transferred.",
  external_reference: "DEMO-NOT-A-REAL-TRANSFER",
  recorded_by: actorId
})
        .select()
        .single();

    if (insertError) throw insertError;

    const { error: auditError } = await supabase
      .from("audit_events")
      .insert({
        cooperative_id: cooperativeId,
        actor_id: actorId,
        entity_type: "payment",
        entity_id: payment.id,
        event_type: "payment_recorded",
        new_values: {
          allocation_id: allocationId,
          amount_rwf: amountRwf,
          payment_method: paymentMethod,
          simulated: true
        },
        reason: "Simulated payment record."
      });

    if (auditError) {
      console.error("Payment audit failed:", auditError.message);

      return res.status(500).json({
        success: false,
        message: "Payment record created, but its audit event failed. Do not retry.",
        data: payment
      });
    }

    return res.status(201).json({
      success: true,
      message: "Simulated payment recorded successfully.",
      data: {
        payment,
        totalPaidRwf: alreadyPaid + amountRwf,
        outstandingRwf: outstanding - amountRwf
      }
    });

  } catch (error) {
    console.error("Payment creation error:", error);

    return res.status(500).json({
      success: false,
      message: "Could not record payment."
    });
  }
});


export default router;
