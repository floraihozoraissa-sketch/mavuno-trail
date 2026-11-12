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
    const actorId = req.user!.id;

    const {
      allocationId,
      amountRwf,
      paymentMethod,
      paymentDate
    } = req.body;

    // Validate allocation ID and payment amount.
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

    // Validate that the date is a real calendar date.
    const parsedDate = new Date(`${paymentDate}T00:00:00Z`);

    if (
      Number.isNaN(parsedDate.getTime()) ||
      parsedDate.toISOString().slice(0, 10) !== paymentDate
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid payment date."
      });
    }

    // Call the existing atomic database function.
    const { data, error } = await supabase.rpc(
      "record_mavunotrail_payment",
      {
        p_allocation_id: allocationId,
        p_amount_rwf: amountRwf,
        p_payment_method: paymentMethod,
        p_payment_date: paymentDate,
        p_actor_id: actorId
      }
    );

    if (error) {
      console.error("Payment RPC error:", error.message);

      const message = error.message ?? "";

      if (
        message.includes("Approved allocation not found") ||
        message.includes("Related sale not found")
      ) {
        return res.status(404).json({
          success: false,
          message: "Approved allocation not found."
        });
      }

      if (
        message.includes("exceeds outstanding balance") ||
        message.includes("no outstanding balance")
      ) {
        return res.status(400).json({
          success: false,
          message: "Payment exceeds or has no remaining allocation balance."
        });
      }

      if (
        message.includes("Payment amount must be positive") ||
        message.includes("Invalid payment method")
      ) {
        return res.status(400).json({
          success: false,
          message: "Invalid payment information."
        });
      }

      throw error;
    }

    return res.status(201).json({
      success: true,
      message: "Simulated payment recorded successfully.",
      data
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
