
import { Router } from "express";
import { supabase } from "../config/supabase";
import {
  requireAuth,
  requireRole
} from "../middleware/auth.middleware";

const router = Router();

const staffAccess = [
  requireAuth,
  requireRole("manager", "staff")
];

router.get("/", ...staffAccess, async (req, res) => {
  try {
    const cooperativeId = req.user!.cooperativeId;

    // 1. Fetch records belonging to this cooperative.
    const [
      farmersResult,
      deliveriesResult,
      batchesResult,
      salesResult
    ] = await Promise.all([
      supabase
        .from("farmers")
        .select("id", { count: "exact", head: true })
        .eq("cooperative_id", cooperativeId),

      supabase
        .from("deliveries")
        .select("quantity_kg")
        .eq("cooperative_id", cooperativeId),

      supabase
        .from("batches")
        .select("id", { count: "exact", head: true })
        .eq("cooperative_id", cooperativeId),

      supabase
        .from("sales")
        .select("id, net_amount_rwf")
        .eq("cooperative_id", cooperativeId)
    ]);

    const initialResults = [
      farmersResult,
      deliveriesResult,
      batchesResult,
      salesResult
    ];

    const initialFailure = initialResults.find(
      result => result.error
    );

    if (initialFailure?.error) {
      console.error(
        "Dashboard query failed:",
        initialFailure.error.message
      );

      return res.status(500).json({
        success: false,
        message: "Could not load dashboard information."
      });
    }

    // 2. Find sale items belonging to this cooperative's sales.
    const saleIds = (salesResult.data ?? []).map(
      sale => sale.id
    );

    let saleBatchItemIds: string[] = [];

    if (saleIds.length > 0) {
      const saleItemsResult = await supabase
        .from("sale_batch_items")
        .select("id")
        .in("sale_id", saleIds);

      if (saleItemsResult.error) {
        throw saleItemsResult.error;
      }

      saleBatchItemIds = (saleItemsResult.data ?? []).map(
        item => item.id
      );
    }

    // 3. Fetch approved allocations for those sale items.
    let allocations: {
      id: string;
      net_amount_rwf: number;
    }[] = [];

    if (saleBatchItemIds.length > 0) {
      const allocationsResult = await supabase
        .from("farmer_allocations")
        .select("id, net_amount_rwf")
        .eq("status", "approved")
        .in("sale_batch_item_id", saleBatchItemIds);

      if (allocationsResult.error) {
        throw allocationsResult.error;
      }

      allocations = allocationsResult.data ?? [];
    }

    // 4. Fetch payments through the cooperative's allocations.
    const allocationIds = allocations.map(
      allocation => allocation.id
    );

    let totalPaymentsRwf = 0;

    if (allocationIds.length > 0) {
      const paymentsResult = await supabase
        .from("payment_records")
        .select("amount_rwf")
        .eq("status", "recorded")
        .in("allocation_id", allocationIds);

      if (paymentsResult.error) {
        throw paymentsResult.error;
      }

      totalPaymentsRwf = (paymentsResult.data ?? [])
        .reduce(
          (sum, payment) =>
            sum + Number(payment.amount_rwf),
          0
        );
    }

    // 5. Calculate dashboard totals.
    const totalDeliveredKg = (deliveriesResult.data ?? [])
      .reduce(
        (sum, delivery) =>
          sum + Number(delivery.quantity_kg),
        0
      );

    const totalSalesRwf = (salesResult.data ?? [])
      .reduce(
        (sum, sale) =>
          sum + Number(sale.net_amount_rwf),
        0
      );

    const totalAllocatedRwf = allocations.reduce(
      (sum, allocation) =>
        sum + Number(allocation.net_amount_rwf),
      0
    );

    return res.status(200).json({
      success: true,
      data: {
        totalFarmers: farmersResult.count ?? 0,
        totalDeliveries: deliveriesResult.data?.length ?? 0,
        totalDeliveredKg,
        totalBatches: batchesResult.count ?? 0,
        totalSales: salesResult.data?.length ?? 0,
        totalSalesRwf,
        totalAllocatedRwf,
        totalPaymentsRwf,
        outstandingRwf: totalAllocatedRwf - totalPaymentsRwf
      }
    });

  } catch (error) {
    console.error("Dashboard error:", error);

    return res.status(500).json({
      success: false,
      message: "Unexpected error loading dashboard."
    });
  }
});

export default router;
