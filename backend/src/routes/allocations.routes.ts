import { Router } from "express";
import { supabase } from "../config/supabase";
import { requireAuth, requireRole } from "../middleware/auth.middleware";

const router = Router();

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET allocations for one farmer
router.get("/farmer/:farmerId", requireAuth, requireRole("manager", "staff"), async (req, res) => {
  try {
    const farmerId = String(req.params.farmerId);

    if (!uuidPattern.test(farmerId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid farmer ID."
      });
    }

    const { data: scopedFarmer, error: scopeError } = await supabase
      .from("farmers")
      .select("id")
      .eq("id", farmerId)
      .eq("cooperative_id", req.user!.cooperativeId)
      .maybeSingle();

    if (scopeError || !scopedFarmer) return res.status(404).json({ success: false, message: "Farmer not found." });

    const { data, error } = await supabase
      .from("farmer_allocations")
      .select(`id, sale_batch_item_id, farmer_id, eligible_quantity_kg, contribution_share, gross_amount_rwf, deductions_rwf, net_amount_rwf, status, approved_at`)
      .eq("farmer_id", farmerId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Farmer allocations query failed:", error.message);

      return res.status(500).json({
        success: false,
        message: "Could not retrieve farmer allocations."
      });
    }

    return res.status(200).json({
      success: true,
      count: data.length,
      data
    });

  } catch (error) {
    console.error("Farmer allocations error:", error);

    return res.status(500).json({
      success: false,
      message: "Unexpected error retrieving allocations."
    });
  }
});

// GET allocations belonging to one sale
router.get("/sale/:saleId", requireAuth, requireRole("manager", "staff"), async (req, res) => {
  try {
    const saleId = String(req.params.saleId);

    if (!uuidPattern.test(saleId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid sale ID."
      });
    }

    const { data: saleItems, error: saleItemsError } =
      await supabase
      .from("sale_batch_items")
      .select("id")
      .eq("sale_id", saleId);

    const { data: scopedSale, error: scopeError } = await supabase
      .from("sales")
      .select("id")
      .eq("id", saleId)
      .eq("cooperative_id", req.user!.cooperativeId)
      .maybeSingle();

    if (scopeError || !scopedSale) return res.status(404).json({ success: false, message: "Sale not found." });

    if (saleItemsError) {
      console.error("Sale items query failed:", saleItemsError.message);

      return res.status(500).json({
        success: false,
        message: "Could not retrieve sale items."
      });
    }

  
const itemIds = (saleItems ?? []).map(item => item.id);

if (itemIds.length === 0) {
  return res.status(200).json({
    success: true,
    count: 0,
    data: []
  });
}

// 1. Retrieve allocations belonging to these sale items.
const { data: allocations, error: allocationsError } = await supabase
  .from("farmer_allocations")
  .select(`
    id,
    sale_batch_item_id,
    farmer_id,
    eligible_quantity_kg,
    contribution_share,
    gross_amount_rwf,
    deductions_rwf,
    net_amount_rwf,
    status,
    approved_at,
    created_at
  `)
  .in("sale_batch_item_id", itemIds)
  .order("created_at", { ascending: true });

if (allocationsError) {
  console.error("Sale allocations query failed:", allocationsError.message);

  return res.status(500).json({
    success: false,
    message: "Could not retrieve sale allocations."
  });
}

const allocationRows = allocations ?? [];

// 2. Retrieve farmer details.
const farmerIds = [
  ...new Set(allocationRows.map(item => item.farmer_id))
];

let farmers: any[] = [];

if (farmerIds.length > 0) {
  const { data, error } = await supabase
    .from("farmers")
    .select("id, farmer_code, full_name")
    .eq("cooperative_id", req.user!.cooperativeId)
    .in("id", farmerIds);

  if (error) {
    console.error("Sale allocation farmers query failed:", error.message);

    return res.status(500).json({
      success: false,
      message: "Could not retrieve allocation farmer details."
    });
  }

  farmers = data ?? [];
}

// 3. Retrieve payments linked to these allocations.
const allocationIds = allocationRows.map(item => item.id);

let payments: any[] = [];

if (allocationIds.length > 0) {
  const { data, error } = await supabase
    .from("payment_records")
    .select(`
      id,
      allocation_id,
      payment_reference,
      amount_rwf,
      payment_method,
      payment_date,
      status
    `)
    .in("allocation_id", allocationIds)
    .order("payment_date", { ascending: false });

  if (error) {
    console.error("Sale allocation payments query failed:", error.message);

    return res.status(500).json({
      success: false,
      message: "Could not retrieve allocation payment records."
    });
  }

  payments = data ?? [];
}

// 4. Combine farmer details and payment progress.
const enrichedAllocations = allocationRows.map(allocation => {
  const farmer = farmers.find(
    item => item.id === allocation.farmer_id
  );

  const farmerPayments = payments.filter(
    payment => payment.allocation_id === allocation.id
  );

  const paidRwf = farmerPayments
    .filter(payment => payment.status === "recorded")
    .reduce(
      (sum, payment) => sum + Number(payment.amount_rwf),
      0
    );

  const allocatedRwf = Number(allocation.net_amount_rwf);

  return {
    ...allocation,
    farmer_name: farmer?.full_name ?? "Unknown farmer",
    farmer_code: farmer?.farmer_code ?? "N/A",
    payments: farmerPayments,
    paidRwf,
    outstandingRwf: Math.max(0, allocatedRwf - paidRwf),
    overpaidRwf: Math.max(0, paidRwf - allocatedRwf)
  };
});

// 5. Return enriched allocations.
return res.status(200).json({
  success: true,
  count: enrichedAllocations.length,
  data: enrichedAllocations
});

} catch (error) {
  console.error("Sale allocations error:", error);

  return res.status(500).json({
    success: false,
    message: "Unexpected error retrieving sale allocations."
  });
}
});

export default router;
