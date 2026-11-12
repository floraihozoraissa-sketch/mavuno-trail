
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

// GET all sales belonging to the user's cooperative
router.get("/", ...staffAccess, async (req, res) => {
  try {
    const cooperativeId = req.user!.cooperativeId;

    const { data, error } = await supabase
      .from("sales")
      .select(`
        id,
        sale_reference,
        buyer_id,
        sale_date,
        gross_amount_rwf,
        deductions_rwf,
        net_amount_rwf,
        status
      `)
      .eq("cooperative_id", cooperativeId)
      .order("sale_date", { ascending: false });

    if (error) {
      console.error("Sales query failed:", error.message);

      return res.status(500).json({
        success: false,
        message: "Could not retrieve sales."
      });
    }

    return res.status(200).json({
      success: true,
      count: data.length,
      data
    });

  } catch (error) {
    console.error("Sales API error:", error);

    return res.status(500).json({
      success: false,
      message: "Unexpected error retrieving sales."
    });
  }
});

// GET one sale with its batch items

router.get("/:id", ...staffAccess, async (req, res) => {
  try {
    const id = req.params.id;
    const cooperativeId = req.user!.cooperativeId;

    const uuidPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    if (typeof id !== "string" || !uuidPattern.test(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid sale ID."
      });
    }

    // 1. Retrieve sale.
    const { data: sale, error: saleError } = await supabase
      .from("sales")
      .select("*")
      .eq("id", id)
      .eq("cooperative_id", cooperativeId)
      .maybeSingle();

    if (saleError) {
      console.error("Sale lookup failed:", saleError.message);

      return res.status(500).json({
        success: false,
        message: "Could not retrieve sale."
      });
    }

    if (!sale) {
      return res.status(404).json({
        success: false,
        message: "Sale not found."
      });
    }

    // 2. Retrieve sale items.
    const { data: items, error: itemsError } = await supabase
      .from("sale_batch_items")
      .select(`
        id,
        batch_id,
        quantity_kg,
        price_per_kg_rwf,
        gross_amount_rwf
      `)
      .eq("sale_id", id);

    if (itemsError) {
      console.error("Sale items query failed:", itemsError.message);

      return res.status(500).json({
        success: false,
        message: "Could not retrieve sale items."
      });
    }

    // 3. Retrieve allocations belonging to this sale.
    const itemIds = (items ?? []).map(item => item.id);

    let allocations: any[] = [];

    if (itemIds.length > 0) {
      const { data, error } = await supabase
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
          approved_at
        `)
        .in("sale_batch_item_id", itemIds);

      if (error) throw error;

      allocations = data ?? [];
    }

    // 4. Retrieve farmer details.
    const farmerIds = [
      ...new Set(allocations.map(item => item.farmer_id))
    ];

    let farmers: any[] = [];

    if (farmerIds.length > 0) {
      const { data, error } = await supabase
        .from("farmers")
        .select("id, farmer_code, full_name")
        .eq("cooperative_id", cooperativeId)
        .in("id", farmerIds);

      if (error) throw error;

      farmers = data ?? [];
    }

    // 5. Retrieve payments linked to these allocations.
    const allocationIds = allocations.map(item => item.id);

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

      if (error) throw error;

      payments = data ?? [];
    }

    // 6. Enrich allocations with farmer and payment information.
    const enrichedAllocations = allocations.map(allocation => {
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

    // 7. Attach allocations to their sale items.
    const enrichedItems = (items ?? []).map(item => ({
      ...item,
      allocations: enrichedAllocations.filter(
        allocation => allocation.sale_batch_item_id === item.id
      )
    }));

    // 8. Calculate sale-level reconciliation.
    const totalAllocatedRwf = enrichedAllocations.reduce(
      (sum, item) => sum + Number(item.net_amount_rwf),
      0
    );

    const totalPaidRwf = enrichedAllocations.reduce(
      (sum, item) => sum + item.paidRwf,
      0
    );

    const saleNetRwf = Number(sale.net_amount_rwf);

    const reconciliation = {
      saleNetRwf,
      totalAllocatedRwf,
      unallocatedRwf: saleNetRwf - totalAllocatedRwf,
      totalPaidRwf,
      outstandingRwf: enrichedAllocations.reduce(
        (sum, item) => sum + item.outstandingRwf,
        0
      )
    };

    // 9. Return complete sale details.
    return res.status(200).json({
      success: true,
      data: {
        ...sale,
        items: enrichedItems,
        totalQuantityKg: (items ?? []).reduce(
          (sum, item) => sum + Number(item.quantity_kg),
          0
        ),
        reconciliation
      }
    });

  } catch (error) {
    console.error("Sale lookup error:", error);

    return res.status(500).json({
      success: false,
      message: "Unexpected error retrieving sale."
    });
  }
});

router.post("/", ...staffAccess, async (req, res) => {
  try {
    const cooperativeId = req.user!.cooperativeId;
    const actorId = req.user!.id;

    const {
      buyerId,
      saleReference,
      saleDate,
      batchId,
      quantityKg,
      pricePerKgRwf,
      deductionsRwf
    } = req.body;

    if (
      typeof buyerId !== "string" ||
      !uuidPattern.test(buyerId) ||
      typeof batchId !== "string" ||
      !uuidPattern.test(batchId) ||
      typeof saleReference !== "string" ||
      !saleReference.trim() ||
      typeof saleDate !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(saleDate) ||
      typeof quantityKg !== "number" ||
      !Number.isFinite(quantityKg) ||
      quantityKg <= 0 ||
      typeof pricePerKgRwf !== "number" ||
      !Number.isSafeInteger(pricePerKgRwf) ||
      pricePerKgRwf < 0 ||
      typeof deductionsRwf !== "number" ||
      !Number.isSafeInteger(deductionsRwf) ||
      deductionsRwf < 0
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid sale information."
      });
    }

    const { data, error } = await supabase.rpc(
      "create_mavunotrail_sale",
      {
        p_cooperative_id: cooperativeId,
        p_actor_id: actorId,
        p_buyer_id: buyerId,
        p_sale_reference: saleReference.trim(),
        p_sale_date: saleDate,
        p_batch_id: batchId,
        p_quantity_kg: quantityKg,
        p_price_per_kg_rwf: pricePerKgRwf,
        p_deductions_rwf: deductionsRwf
      }
    );

    if (error) {
      console.error("Sale creation failed:", error.message);

      return res.status(400).json({
        success: false,
        message: "Sale could not be created. Check the sale information.",
        error: error.message
      });
    }

    return res.status(201).json({
      success: true,
      message: "Sale and farmer allocations created successfully.",
      data
    });

  } catch (error) {
    console.error("Sale creation error:", error);

    return res.status(500).json({
      success: false,
      message: "Could not create sale."
    });
  }
});


export default router;
