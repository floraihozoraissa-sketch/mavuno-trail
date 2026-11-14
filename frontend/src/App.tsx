import { useCallback, useEffect, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import {
  LayoutDashboard,
  Users,
  Truck,
  Package,
  ShoppingCart,
  ChartPie,
  CreditCard,
  FileText,
  LogOut,
  CheckCircle,
  AlertCircle,
  Info,
  Wallet,
  Check,
  ChevronRight,
  ChevronLeft,
  X,
  Loader2,
  RefreshCw,
  Plus,
  Hand,
  Home,
  Wheat,
  CreditCard as CreditCardIcon,
  Truck as TruckIcon,
  Scale,
  ClipboardList,
  Search,
  ArrowRight,
  Shield,
} from "lucide-react";
import { ThirdwebProvider } from "thirdweb/react";
import { createThirdwebClient } from "thirdweb";
import { BrowserProvider, Contract } from "ethers";
import heroImage from "./assets/hero.png";
import "./design-system.css";
import "./App.css";
import "./theme.css";

const clientId = import.meta.env.VITE_THIRDWEB_CLIENT_ID;
const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";
if (clientId) createThirdwebClient({ clientId });
type Row = Record<string, any>;
type Section =
  | "overview"
  | "farmers"
  | "deliveries"
  | "batches"
  | "sales"
  | "allocations"
  | "payments"
  | "audit";
const nav: { id: Section; label: string; icon: string }[] = [
  { id: "overview", label: "Overview", icon: "⌂" },
  { id: "farmers", label: "Farmers", icon: "♧" },
  { id: "deliveries", label: "Deliveries", icon: "⇣" },
  { id: "batches", label: "Batches", icon: "▦" },
  { id: "sales", label: "Buyer sales", icon: "↗" },
  { id: "allocations", label: "Allocations", icon: "◷" },
  { id: "payments", label: "Payments", icon: "₣" },
  { id: "audit", label: "Audit history", icon: "⌁" },
];
const money = (value: unknown) =>
  `FRW ${Number(value || 0).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
const kg = (value: unknown) =>
  `${Number(value || 0).toLocaleString("en-US", { maximumFractionDigits: 1 })} kg`;
const date = (value: unknown) =>
  value
    ? new Date(String(value)).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "—";
const title = (value: unknown) =>
  String(value || "—")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

async function request<T = Row>(
  path: string,
  token: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...init?.headers,
    },
  });
  const result = await response.json().catch(() => ({}));
  if (response.status === 401) {
    sessionStorage.removeItem("mavunotrail_token");
    window.dispatchEvent(new Event("mavuno-session-expired"));
  }
  if (!response.ok || result.success === false)
    throw new Error(result.message || `Request failed (${response.status})`);
  return result as T;
}

function Brand({ large = false }: { large?: boolean }) {
  return (
    <div className={`brand ${large ? "brand-large" : ""}`}>
      <span className="brand-mark" aria-hidden="true">
        <svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
          <path
            d="M13 47V19h8l11 14 11-14h8v28h-9V32L32 45 22 32v15z"
            fill="#ffffff"
          />
          <path d="M45 12c4-3 8-3 11-2-1 5-4 9-10 10" fill="#b9d9bd" />
        </svg>
      </span>

      <span className="brand-name">
        Mavuno<span className="brand-light">Trail</span>
        <small>EVERY HARVEST HAS A STORY. FOLLOW YOURS.</small>
      </span>
    </div>
  );
}

// Wallet login for cooperative staff
function WalletLogin({
  onAuthenticated,
  onDemo,
}: {
  onAuthenticated: (token: string, identity: Row) => void;
  onDemo: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  async function login() {
    const ethereum = (window as Window & { ethereum?: any }).ethereum;
    if (!ethereum)
      return setMessage("MetaMask not detected. Install MetaMask to sign in.");
    setLoading(true);
    try {
      setMessage("Requesting a secure sign-in nonce…");
      await ethereum.request({ method: "eth_requestAccounts" });
      const provider = new BrowserProvider(ethereum);
      const signer = await provider.getSigner();
      const address = await signer.getAddress();

      const { SiweMessage } = await import("siwe");
      const nr = await fetch(`${API_URL}/api/auth/nonce`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress: address }),
      });
      const nonceResult = await nr.json();
      if (!nr.ok || !nonceResult.success)
        throw new Error(nonceResult.message || "Could not obtain login nonce.");
      const nonceData = nonceResult.data ?? nonceResult;
      const siwe = new SiweMessage({
        domain: window.location.host,
        address,
        statement: "Sign in to MavunoTrail.",
        uri: window.location.origin,
        version: "1",
        chainId: 11155111,
        nonce: nonceData.nonce,
        issuedAt: new Date().toISOString(),
        expirationTime: new Date(Date.now() + 300000).toISOString(),
      });
      setMessage("Approve the sign-in request in MetaMask…");
      const signature = await signer.signMessage(siwe.prepareMessage());
      const vr = await fetch(`${API_URL}/api/auth/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: siwe.prepareMessage(), signature }),
      });
      const verified = await vr.json();
      if (!vr.ok || !verified.success)
        throw new Error(verified.message || "Wallet verification failed.");
      const auth = verified.data ?? verified;
      if (!auth.token)
        throw new Error("The server did not return an authentication token.");
      sessionStorage.setItem("mavunotrail_token", auth.token);
      const identity = await request<{ data: Row }>("/api/auth/me", auth.token);
      if (!["manager", "staff"].includes(identity.data.role))
        throw new Error("This workspace is for cooperative staff accounts.");
      onAuthenticated(auth.token, identity.data);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Sign-in failed. Please try again.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-page login-staff">
      <section className="login-card">
        <div className="flex flex-col items-center text-center mb-6">
          <Brand large />
        </div>

        <div className="text-center mb-6">
          <div className="text-micro font-semibold text-brand mb-2">COOPERATIVE WORKSPACE</div>
          <h1 className="text-h1">Every delivery. Every decision. Clearly recorded.</h1>
          <p className="text-body text-secondary mt-3">
            Manage farmer deliveries, cooperative sales and payment records with a
            clearer view of every harvest.
          </p>
        </div>

        <div className="space-y-4">
          <button
            className="btn btn-primary btn-full btn-lg"
            onClick={login}
            disabled={loading}
            type="button"
          >
            <Wallet size={20} strokeWidth={2} aria-hidden="true" />
            {loading ? "Signing in..." : "Sign in with MetaMask"}
          </button>

          <p className="text-caption text-secondary text-center">
            Connect the cooperative wallet registered for staff access.
          </p>
        </div>

        {message && (
          <div className="alert alert-error mt-4" role="status" aria-live="polite">
            <AlertCircle className="alert-icon" size={20} strokeWidth={2} aria-hidden="true" />
            <div className="alert-content">
              <p className="alert-message">{message}</p>
            </div>
          </div>
        )}

        <div className="relative my-6">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-neutral-200" />
          </div>
          <div className="relative flex justify-center text-sm">
            <span className="px-4 bg-white text-neutral-400 font-medium">Or explore</span>
          </div>
        </div>

        <button
          className="btn btn-secondary btn-full"
          onClick={onDemo}
          type="button"
        >
          Explore the farmer demo
        </button>

        <p className="text-micro text-tertiary text-center mt-4">
          Demo farmer records are fictional. Staff access requires wallet
          verification and an authorised cooperative account.
        </p>
      </section>

      <div className="login-art">
        <img src={heroImage} alt="Potato harvest in Rwanda" />
        <div className="art-caption">
          <span>BUILT AROUND RWANDAN FARMERS</span>
          <strong>
            Every harvest
            <br />
            has a story.
          </strong>
          <p>Every harvest has a story. Follow yours.</p>
        </div>
      </div>
    </main>
  );
}

// Farmer login screen for demo mode
function FarmerLogin({
  onAuthenticated,
}: {
  onAuthenticated: (token: string, identity: Row) => void;
}) {
  const [farmerCode, setFarmerCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  async function login() {
    if (!farmerCode.trim())
      return setMessage("Enter a farmer code to continue.");
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch(`${API_URL}/api/auth/farmer/demo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ farmerCode: farmerCode.trim().toUpperCase() }),
      });
      const result = await response.json();
      if (!response.ok || !result.success)
        throw new Error(result.message || "Demo access failed.");
      sessionStorage.setItem("mavunotrail_farmer_token", result.data.token);
      console.log("LOGIN USER BEFORE PASSING:", result.data.user);
      console.log("LOGIN FARMER ID:", result.data.user?.farmerId);
      onAuthenticated(result.data.token, result.data.user);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not access demo farmer records.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-page login-farmer">
      <section className="login-card">
        <div className="flex flex-col items-center text-center mb-6">
          <Brand large />
        </div>

        <div className="text-center mb-6">
          <div className="text-micro font-semibold text-brand mb-2">FARMER PORTAL</div>
          <h1 className="text-h1">Your harvest. Your records.</h1>
          <p className="text-body text-secondary mt-3">
            See your recorded deliveries, understand your share of cooperative
            sales and follow your payment records.
          </p>
        </div>

        <div className="space-y-4">
          <div className="input-wrapper">
            <label className="input-label" htmlFor="farmer-code">Your farmer code</label>
            <input
              id="farmer-code"
              className="input"
              value={farmerCode}
              onChange={(e) => setFarmerCode(e.target.value.toUpperCase())}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !loading) login();
              }}
              placeholder="Enter your code"
              autoComplete="off"
              style={{ textTransform: "uppercase" }}
            />
          </div>

          <button
            className="btn btn-primary btn-full btn-lg"
            onClick={login}
            disabled={loading}
            type="button"
          >
            {loading ? "Loading..." : "View my harvest"}
          </button>
        </div>

        {message && (
          <div className="alert alert-error" role="status" aria-live="polite">
            <AlertCircle className="alert-icon" size={20} strokeWidth={2} aria-hidden="true" />
            <div className="alert-content">
              <p className="alert-message">{message}</p>
            </div>
          </div>
        )}

        <div className="card" style={{background: 'var(--color-bg-tertiary)'}}>
          <p className="text-caption font-semibold text-primary mb-3">Try a demonstration account</p>
          <div className="flex flex-wrap gap-2 justify-center">
            {"F-0248 F-0312 F-0156 F-0421".split(" ").map((c) => (
              <button
                key={c}
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setFarmerCode(c)}
                style={{minWidth: '80px'}}
              >
                {c}
              </button>
            ))}
          </div>
          <p className="text-micro text-tertiary text-center mt-3">
            These are fictional demonstration records. No real farmer data is
            exposed.
          </p>
        </div>

        <div className="relative my-6">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-neutral-200" />
          </div>
          <div className="relative flex justify-center text-sm">
            <span className="px-4 bg-white text-neutral-400 font-medium">Or return</span>
          </div>
        </div>

        <button
          className="btn btn-secondary btn-full"
          onClick={() => window.location.reload()}
          type="button"
        >
          Back to cooperative portal
        </button>
      </section>

      <div className="login-art">
        <img src={heroImage} alt="Potato harvest in Rwanda" />
        <div className="art-caption">
          <span>YOUR HARVEST, YOUR INFORMATION</span>
          <strong>
            Know what
            <br />
            happens next.
          </strong>
          <p>Every harvest has a story. Follow yours.</p>
        </div>
      </div>
    </main>
  );
}

// Main farmer application with real backend data

function FarmerApp({
  token,
  identity,
  onLogout,
}: {
  token: string;
  identity: Row;
  onLogout: () => void;
}) {
  const [active, setActive] = useState<
    "home" | "journey" | "payments" | "deliveries"
  >("home");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [statement, setStatement] = useState<Row | null>(null);
  const [deliveries, setDeliveries] = useState<Row[]>([]);
  const [auditEvents, setAuditEvents] = useState<Row[]>([]);

  const [respondingId, setRespondingId] = useState<string | null>(null);
  const [disputeDeliveryId, setDisputeDeliveryId] = useState<string | null>(
    null,
  );
  const [disputeNote, setDisputeNote] = useState("");
  const [responseFeedback, setResponseFeedback] = useState<{
    deliveryId: string;
    kind: "success" | "error";
    message: string;
  } | null>(null);

  console.log("FARMER IDENTITY RECEIVED:", identity);
  console.log("FARMER PROFILE ID:", identity?.farmerId);
  console.log("APPLICATION USER ID:", identity?.id);

  useEffect(() => {
    let mounted = true;

    async function load() {
      setBusy(true);
      setError("");

      try {
        const [stmt, del, audits] = await Promise.all([
          request<{ data: Row }>(
            `/api/statements/farmer/${identity.farmerId}`,
            token,
          ),

          request<{ data: Row[] }>(
            `/api/deliveries?farmerId=${identity.farmerId}`,
            token,
          ),
          request<{ data: Row[] }>(`/api/audit-blockchain/events`, token),
        ]);

        if (!mounted) return;

        setStatement(stmt.data);
        setDeliveries(del.data);

        const deliveryIds = new Set(del.data.map((d: Row) => d.id));

        const farmerAudits = (audits.data || []).filter(
          (a: Row) =>
            a.entity_type === "delivery" && deliveryIds.has(a.entity_id),
        );

        setAuditEvents(farmerAudits);
      } catch (e) {
        if (mounted) {
          setError(
            e instanceof Error
              ? e.message
              : "Could not load your harvest records.",
          );
        }
      } finally {
        if (mounted) setBusy(false);
      }
    }

    load();

    return () => {
      mounted = false;
    };
  }, [token, identity.id, identity.farmerId]);

  const submitDeliveryResponse = async (
    delivery: Row,
    response: "confirmed" | "disputed",
  ) => {
    if (respondingId || delivery.farmer_confirmation_status !== "pending") {
      return;
    }

    const note = disputeNote.trim();

    if (response === "disputed" && !note) {
      setResponseFeedback({
        deliveryId: delivery.id,
        kind: "error",
        message: "Please explain why you are disputing this delivery.",
      });
      return;
    }

    setRespondingId(delivery.id);
    setResponseFeedback(null);

    try {
      const result = await request<{ data: Row }>(
        `/api/deliveries/${delivery.id}/${response === "confirmed" ? "confirm" : "dispute"}`,
        token,
        {
          method: "POST",
          body: JSON.stringify({
            ...(response === "disputed" ? { note } : {}),
          }),
        },
      );

      // Update the delivery immediately using the backend response.
      setDeliveries((current) =>
        current.map((d) =>
          d.id === delivery.id ? { ...d, ...result.data } : d,
        ),
      );

      setDisputeDeliveryId(null);
      setDisputeNote("");

      setResponseFeedback({
        deliveryId: delivery.id,
        kind: "success",
        message:
          response === "confirmed"
            ? "You confirmed this delivery successfully."
            : "Your delivery dispute has been submitted.",
      });

      // Refresh audit events so the farmer can see the new response event.
      try {
        const audits = await request<{ data: Row[] }>(
          `/api/audit-blockchain/events`,
          token,
        );

        const deliveryIds = new Set(deliveries.map((d: Row) => d.id));

        const farmerAudits = (audits.data || []).filter(
          (a: Row) =>
            a.entity_type === "delivery" && deliveryIds.has(a.entity_id),
        );

        setAuditEvents(farmerAudits);
      } catch {
        // The response was already saved. An audit refresh failure
        // should not make the farmer think the response failed.
      }
    } catch (e) {
      setResponseFeedback({
        deliveryId: delivery.id,
        kind: "error",
        message:
          e instanceof Error
            ? e.message
            : "Could not submit your delivery response.",
      });
    } finally {
      setRespondingId(null);
    }
  };

  // Reusable farmer confirmation/dispute interface.
  const renderDeliveryResponse = (delivery: Row) => {
    const confirmationStatus = delivery.farmer_confirmation_status || "pending";
    const isResponding = respondingId === delivery.id;
    const isDisputing = disputeDeliveryId === delivery.id;
    const feedback =
      responseFeedback?.deliveryId === delivery.id ? responseFeedback : null;

    return (
      <div className="farmer-response-panel">
        <div className="farmer-response-heading">
          <div>
            <span className="eyebrow">YOUR DELIVERY RESPONSE</span>
            <strong>
              {confirmationStatus === "confirmed"
                ? "You confirmed this delivery"
                : confirmationStatus === "disputed"
                  ? "You disputed this delivery"
                  : "Have you checked these details?"}
            </strong>
          </div>

<span
            className={`status ${
              confirmationStatus === "confirmed"
                ? "status-good"
                : confirmationStatus === "disputed"
                ? "status-warning"
                : "status-neutral"
            }`}
          >
            <span className="status-dot" aria-hidden="true" />
            {title(confirmationStatus)}
          </span>
        </div>

        {confirmationStatus === "pending" ? (
          <>
            <p className="table-note">
              Check the recorded quantity and grade. Confirm if they are
              correct, or submit a dispute if something needs to be reviewed.
            </p>

            {isDisputing && (
              <div className="farmer-dispute-form">
                <label htmlFor={`dispute-note-${delivery.id}`}>
                  Why are you disputing this delivery?
                </label>

                <textarea
                  id={`dispute-note-${delivery.id}`}
                  value={disputeNote}
                  onChange={(e) => setDisputeNote(e.target.value)}
                  placeholder="Explain what is incorrect..."
                  maxLength={1000}
                  rows={3}
                  disabled={isResponding}
                />

                <small>{disputeNote.length}/1000 characters</small>

                <div className="farmer-response-actions">
                  <button
                    className="button outline"
                    type="button"
                    onClick={() => {
                      setDisputeDeliveryId(null);
                      setDisputeNote("");
                      setResponseFeedback(null);
                    }}
                    disabled={isResponding}
                  >
                    Cancel
                  </button>

                  <button
                    className="button"
                    type="button"
                    onClick={() => submitDeliveryResponse(delivery, "disputed")}
                    disabled={isResponding || !disputeNote.trim()}
                  >
                    {isResponding ? "Submitting…" : "Submit dispute"}
                  </button>
                </div>
              </div>
            )}

            {!isDisputing && (
              <div className="farmer-response-actions">
                <button
                  className="button outline"
                  type="button"
                  onClick={() => {
                    setDisputeDeliveryId(delivery.id);
                    setDisputeNote("");
                    setResponseFeedback(null);
                  }}
                  disabled={isResponding}
                >
                  Dispute delivery
                </button>

                <button
                  className="button"
                  type="button"
                  onClick={() => submitDeliveryResponse(delivery, "confirmed")}
                  disabled={isResponding}
                >
                  {isResponding ? "Submitting…" : "Confirm delivery"}
                </button>
              </div>
            )}
          </>
        ) : (
          <>
            <p className="table-note">
              {confirmationStatus === "confirmed"
                ? "Your confirmation has been recorded. You cannot submit another response for this delivery."
                : "Your dispute has been recorded for cooperative review. You cannot submit another response for this delivery."}
            </p>

            {delivery.farmer_response_note && (
              <div className="farmer-response-note">
                <strong>Your response note</strong>
                <p>{delivery.farmer_response_note}</p>
              </div>
            )}

            {delivery.farmer_responded_at && (
              <small className="response-timestamp">
                Responded: {date(delivery.farmer_responded_at)}
              </small>
            )}
          </>
        )}

        {feedback && (
          <div
            className={`alert ${
              feedback.kind === "success" ? "success-alert" : "error-alert"
            }`}
            role="status"
          >
            {feedback.message}
          </div>
        )}
      </div>
    );
  };

  if (busy) {
    return (
      <div className="farmer-shell">
        <header className="farmer-top">
          <Brand />
          <span className="demo-chip">DEMO FARMER MODE</span>
          <button className="btn btn-ghost btn-icon" onClick={onLogout} aria-label="Exit demo">
            <LogOut size={18} strokeWidth={2} aria-hidden="true" />
          </button>
        </header>
        <div className="auth-loading flex items-center justify-center min-h-[60vh] gap-3 text-secondary">
          <Loader2 className="animate-spin" size={24} strokeWidth={2} aria-hidden="true" />
          <span>Loading your harvest records…</span>
        </div>
      </div>
    );
  }

  const summary = statement?.summary || {
    totalAllocatedRwf: 0,
    totalPaidRwf: 0,
    outstandingRwf: 0,
  };

  const allocations = statement?.allocations || [];
  const payments = statement?.payments || [];
  const farmer = statement?.farmer || identity;

  // Batch membership comes from the delivery's batch relationship.
  // Sale and payment figures below are farmer-account totals, not
  // proof that a particular delivery has been paid.
  const getDeliveryJourney = (delivery: Row) => {
    const hasBatch = (delivery.batch_deliveries || []).length > 0;
    const hasAllocation = allocations.length > 0;
    const hasSale = hasAllocation;
    const hasPayment = payments.length > 0;

    return { hasBatch, hasSale, hasAllocation, hasPayment };
  };

  const primaryDelivery = deliveries[0];

  const primaryJourney = primaryDelivery
    ? getDeliveryJourney(primaryDelivery)
    : {
        hasBatch: false,
        hasSale: false,
        hasAllocation: false,
        hasPayment: false,
      };

  const journeyStatuses = [
    {
      label: "Delivered",
      detail: primaryDelivery
        ? `${date(primaryDelivery.delivered_at)} · ${kg(primaryDelivery.quantity_kg)}`
        : "—",
      complete: !!primaryDelivery,
    },
    {
      label: "In a batch",
      detail: primaryJourney.hasBatch
        ? `Batch ${primaryDelivery?.batch_deliveries?.[0]?.batch_id?.slice(0, 8) || "created"}`
        : "Awaiting batch assignment",
      complete: primaryJourney.hasBatch,
    },
    {
      label: "Sale allocation",
      detail: primaryJourney.hasSale
        ? "An allocation is recorded on your account"
        : "Awaiting a sale allocation",
      complete: primaryJourney.hasSale,
    },
    {
      label: "Allocated",
      detail: primaryJourney.hasAllocation
        ? `${money(summary.totalAllocatedRwf)} allocated to your account`
        : "No allocation recorded yet",
      complete: primaryJourney.hasAllocation,
    },
    {
      label: "Payment recorded",
      detail: primaryJourney.hasPayment
        ? `${money(summary.totalPaidRwf)} recorded as paid on your account`
        : "Awaiting a payment record",
      complete: primaryJourney.hasPayment,
    },
  ];

  return (
    <div className="farmer-shell">
      <header className="farmer-top">
        <Brand />
        <span className="demo-chip">DEMO FARMER MODE</span>
        <button className="btn btn-ghost btn-icon" onClick={onLogout} aria-label="Exit demo">
          <LogOut size={18} strokeWidth={2} aria-hidden="true" />
        </button>
      </header>

      <main className="farmer-content">
        <div className="farmer-greeting">
          <div className="text-micro font-semibold text-brand mb-2">YOUR HARVEST, YOUR STORY</div>
          <h1 className="text-h2">
            Muraho, {farmer.full_name?.split(" ")[0] || "Farmer"}{" "}
            <Hand size={24} strokeWidth={2} aria-hidden="true" />
          </h1>
          <p className="text-body text-secondary">
            {farmer.farmer_code} <span className="text-tertiary">·</span> {" "}
            {[farmer.village, farmer.district].filter(Boolean).join(", ")}
          </p>
        </div>

        <div className="alert alert-info">
          <Info className="alert-icon" size={20} strokeWidth={2} aria-hidden="true" />
          <div className="alert-content">
            <div className="alert-title">Fictional demo account</div>
            <p className="alert-message">
              This example uses sample records only. It is not connected to a
              real farmer account or real payments.
            </p>
          </div>
        </div>

        {error && (
          <div className="alert alert-error" role="alert">
            <AlertCircle className="alert-icon" size={20} strokeWidth={2} aria-hidden="true" />
            <div className="alert-content">
              <p className="alert-message">{error}</p>
            </div>
            <button className="alert-dismiss" onClick={() => setError("")} aria-label="Dismiss">
              <X size={18} strokeWidth={2} aria-hidden="true" />
            </button>
          </div>
        )}

        {active === "home" && (
          <>
            <section className="earnings-card">
              <div className="light-label">TOTAL ALLOCATED</div>
              <strong>{money(summary.totalAllocatedRwf)}</strong>

              <div className="earned-meta">
                <span>
                  <span className="paid-dot" aria-hidden="true" /> {money(summary.totalPaidRwf)} paid
                </span>
                <span>{money(summary.outstandingRwf)} balance</span>
              </div>

              <div className="progress">
                <div className="progress-bar" style={{width: 
                  `${summary.totalAllocatedRwf > 0 
                    ? Math.min(100, Math.round((summary.totalPaidRwf / summary.totalAllocatedRwf) * 100)) 
                    : 0}%`}} />
              </div>

              <small>
                {summary.totalAllocatedRwf > 0
                  ? `${Math.min(100, Math.round((summary.totalPaidRwf / summary.totalAllocatedRwf) * 100))}%`
                  : "0%"}{" "}
                of your allocation recorded as paid
              </small>
            </section>

            <section className="journey-card">
              <div className="flex items-center justify-between gap-4 mb-5">
                <div>
                  <div className="text-micro font-semibold text-brand mb-1">HARVEST JOURNEY</div>
                  <h2 className="text-h3">From your farm to the market</h2>
                </div>
                <span className="status-badge status-pending">
                  {journeyStatuses.filter((s) => s.complete).length} of {journeyStatuses.length} steps complete
                </span>
              </div>

              <div className="journey-line">
                {journeyStatuses.map((step, i) => (
                  <div
                    className={`journey-step ${step.complete ? "complete" : ""}`}
                    key={step.label}
                  >
                    <div className="journey-node">
                      {step.complete ? <Check size={14} strokeWidth={2.5} aria-hidden="true" /> : <span>{i + 1}</span>}
                    </div>
                    <div className="journey-step-content">
                      <strong className="journey-step-label">{step.label}</strong>
                      <small className="journey-step-detail">{step.detail}</small>
                    </div>
                  </div>
                ))}
              </div>

              <button
                className="btn btn-outline btn-full mt-4"
                onClick={() => setActive("journey")}
              >
                Follow delivery details
                <ChevronRight size={16} strokeWidth={2} aria-hidden="true" />
              </button>
            </section>

            <div className="farmer-mini-grid">
              <button className="group" onClick={() => setActive("payments")}>
                <div className="icon-wrapper">
                  <CreditCard size={20} strokeWidth={2} aria-hidden="true" />
                </div>
                <strong>Payment summary</strong>
                <small>{money(summary.outstandingRwf)} outstanding</small>
              </button>

              <button className="group" onClick={() => setActive("deliveries")}>
                <div className="icon-wrapper">
                  <Package size={20} strokeWidth={2} aria-hidden="true" />
                </div>
                <strong>Delivery history</strong>
                <small>{deliveries.length} recorded</small>
              </button>
            </div>

            <p className="text-caption text-tertiary text-center mt-6">
              Payment records shown here are simulated examples. No money has
              been transferred.
            </p>
          </>
        )}

        {active === "journey" && (
          <section className="journey-card demo-detail">
            <button className="text-button" onClick={() => setActive("home")}>
              ← Back to home
            </button>

            {primaryDelivery ? (
              <>
                <span className="eyebrow">
                  DELIVERY RECEIPT · {primaryDelivery.delivery_reference}
                </span>
                <h2>Potato delivery</h2>

                <div className="detail-grid">
                  <span>
                    Delivered
                    <strong>{date(primaryDelivery.delivered_at)}</strong>
                  </span>
                  <span>
                    Quantity
                    <strong>{kg(primaryDelivery.quantity_kg)}</strong>
                  </span>
                  <span>
                    Grade
                    <strong>Grade {primaryDelivery.grade}</strong>
                  </span>
                  <span>
                    Collection centre
                    <strong>
                      {primaryDelivery.collection_centre?.name ||
                        "Selected centre"}
                    </strong>
                  </span>
                  <span>
                    Batch
                    <strong>
                      {primaryDelivery.batch_deliveries?.[0]?.batch_id?.slice(
                        0,
                        8,
                      ) || "Not yet assigned"}
                    </strong>
                  </span>
                  <span>
                    Status
                    <strong>{title(primaryDelivery.status)}</strong>
                  </span>
                </div>

                {renderDeliveryResponse(primaryDelivery)}

                <div className="journey-line compact">
                  {journeyStatuses.map((step, i) => (
                    <div
                      className={`journey-step ${step.complete ? "complete" : ""}`}
                      key={step.label}
                    >
                      <span className="journey-node">
                        {step.complete ? "✓" : i + 1}
                      </span>
                      <div>
                        <strong>{step.label}</strong>
                        <small>{step.detail}</small>
                      </div>
                    </div>
                  ))}
                </div>

                {auditEvents.length > 0 && (
                  <div className="audit-section">
                    <span className="eyebrow">DELIVERY AUDIT HISTORY</span>
                    <p className="table-note">
                      These events are recorded in MavunoTrail's audit history.
                      An event is only blockchain-anchored when a verified
                      transaction is available.
                    </p>

                    <div className="audit-list">
                      {auditEvents.slice(0, 5).map((a: Row) => {
                        const anchor = a.audit_event_anchors?.[0];

                        return (
                          <div key={a.id} className="audit-item">
                            <span className="audit-event">
                              {title(a.event_type)}
                            </span>
                            <span className="audit-date">
                              {date(a.recorded_at)}
                            </span>

                            {anchor?.transaction_hash ? (
                              <a
                                className="hash-link"
                                href={`https://sepolia.etherscan.io/tx/${anchor.transaction_hash}`}
                                target="_blank"
                                rel="noreferrer"
                              >
                                View verified transaction ↗
                              </a>
                            ) : (
                              <span className="audit-date">
                                Recorded · awaiting blockchain anchoring
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <p className="empty-state">No deliveries recorded yet.</p>
            )}
          </section>
        )}

        {active === "payments" && (
          <section className="journey-card demo-detail">
            <button className="text-button" onClick={() => setActive("home")}>
              ← Back to home
            </button>

            <span className="eyebrow">PAYMENT SUMMARY</span>
            <h2>Your allocation</h2>

            {allocations.length > 0 && (
              <div className="allocation-breakdown">
                {allocations.map((a: Row) => (
                  <div key={a.id} className="alloc-item">
                    <div className="alloc-header">
                      <span>{a.sale_batch_item_id?.slice(0, 8)}</span>
                      <strong>{money(a.net_amount_rwf)}</strong>
                    </div>
                    <div className="alloc-details">
                      <span>Eligible: {kg(a.eligible_quantity_kg)}</span>
                      <span>
                        Share: {(Number(a.contribution_share) * 100).toFixed(1)}
                        %
                      </span>
                      <span>Deductions: {money(a.deductions_rwf)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="demo-payment-row">
              <span>Recorded allocation</span>
              <strong>{money(summary.totalAllocatedRwf)}</strong>
            </div>
            <div className="demo-payment-row">
              <span>Payments recorded</span>
              <strong className="green-text">
                {money(summary.totalPaidRwf)}
              </strong>
            </div>
            <div className="demo-payment-row">
              <span>Balance remaining</span>
              <strong>{money(summary.outstandingRwf)}</strong>
            </div>

            {payments.length > 0 && (
              <div className="payment-history">
                <h3>
                  Payment records <small>SIMULATED</small>
                </h3>
                {payments.map((p: Row) => (
                  <div key={p.id} className="payment-item">
                    <span>
                      {date(p.payment_date)} · {title(p.payment_method)}
                    </span>
                    <strong>{money(p.amount_rwf)}</strong>
                  </div>
                ))}
              </div>
            )}

            <p className="sim-note">
              A cooperative records a simulated payment entry here. This is not
              a mobile-money transfer.
            </p>
          </section>
        )}

        {active === "deliveries" && (
          <section className="journey-card demo-detail">
            <div className="flex items-center gap-4 mb-4">
              <button className="btn btn-ghost btn-icon" onClick={() => setActive("home")} aria-label="Back to home">
                <ChevronLeft size={20} strokeWidth={2} aria-hidden="true" />
              </button>
              <div className="flex-1 min-w-0">
                <span className="eyebrow">DELIVERY HISTORY</span>
                <h2 className="text-h3 truncate">{deliveries.length} recorded deliveries</h2>
              </div>
            </div>

            {deliveries.length > 0 ? (
              <div className="deliveries-list">
                {deliveries.map((d: Row) => (
                  <div key={d.id} className="delivery-item">
                    <div className="delivery-main">
                      <strong>{d.delivery_reference}</strong>
                      <span>
                        {date(d.delivered_at)} · {kg(d.quantity_kg)} · Grade{" "}
                        {d.grade}
                      </span>
                    </div>

                    <div className="delivery-meta">
                      <span>{d.collection_centre?.name || "Centre"}</span>
                      <span
                        className={`status ${
                          ["recorded", "approved"].includes(d.status)
                            ? "status-good"
                            : "status-neutral"
                        }`}
                      >
                        <span className="status-dot" aria-hidden="true" />
                        {title(d.status)}
                      </span>
                    </div>

                    {renderDeliveryResponse(d)}
                  </div>
                ))}
              </div>
            ) : (
              <p className="empty-state">No deliveries recorded yet.</p>
            )}
          </section>
        )}
      </main>

      <nav className="farmer-bottom">
        <button
          className={active === "home" ? "selected" : ""}
          onClick={() => setActive("home")}
        >
          <Home size={24} strokeWidth={2} aria-hidden="true" />
          Home
        </button>

        <button
          className={active === "journey" ? "selected" : ""}
          onClick={() => setActive("journey")}
        >
          <Wheat size={24} strokeWidth={2} aria-hidden="true" />
          My harvest
        </button>

        <button
          className={active === "payments" ? "selected" : ""}
          onClick={() => setActive("payments")}
        >
          <CreditCardIcon size={24} strokeWidth={2} aria-hidden="true" />
          Payments
        </button>

        <button
          className={active === "deliveries" ? "selected" : ""}
          onClick={() => setActive("deliveries")}
        >
          <TruckIcon size={24} strokeWidth={2} aria-hidden="true" />
          Deliveries
        </button>
      </nav>
    </div>
  );
}

function StaffNavIcon({ id, className }: { id: string; className?: string }) {
  const common = { size: 20, strokeWidth: 2, "aria-hidden": true as const, className };

  switch (id) {
    case "overview":
      return <LayoutDashboard {...common} />;
    case "farmers":
      return <Users {...common} />;
    case "deliveries":
      return <Truck {...common} />;
    case "batches":
      return <Package {...common} />;
    case "sales":
      return <ShoppingCart {...common} />;
    case "allocations":
      return <ChartPie {...common} />;
    case "payments":
      return <CreditCard {...common} />;
    case "audit":
      return <FileText {...common} />;
    default:
      return <LayoutDashboard {...common} />;
  }
}

// Staff application
function StaffApp({
  token,
  identity,
  onLogout,
}: {
  token: string;
  identity: Row;
  onLogout: () => void;
}) {
  const [section, setSection] = useState<Section>("overview");
  const [data, setData] = useState<Record<string, any>>({});
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [receipt, setReceipt] = useState<Row | null>(null);
  const [farmerRecord, setFarmerRecord] = useState<Row | null>(null);
  const [batchRecord, setBatchRecord] = useState<Row | null>(null);
  const [selectedSale, setSelectedSale] = useState<Row | null>(null);
  const [showDeliveryForm, setShowDeliveryForm] = useState(false);
  const [showSaleForm, setShowSaleForm] = useState(false);
  const [showBatchForm, setShowBatchForm] = useState(false);
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [batchGrade, setBatchGrade] = useState("A");
  const [searchTerm, setSearchTerm] = useState("");
  const [saving, setSaving] = useState(false);
  const [anchoring, setAnchoring] = useState("");
  const load = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const paths: Record<string, string> = {
        dashboard: "/api/dashboard",
        farmers: "/api/farmers",
        deliveries: "/api/deliveries",
        batches: "/api/batches",
        sales: "/api/sales",
        payments: "/api/payments",
        centres: "/api/reference/collection-centres",
        buyers: "/api/reference/buyers",
        audits: "/api/audit-blockchain/events",
      };
      const entries = await Promise.all(
        Object.entries(paths).map(
          async ([key, path]) =>
            [
              key,
              await request<{ data: any }>(path, token).then(
                (result) => result.data,
              ),
            ] as const,
        ),
      );
      const next = Object.fromEntries(entries);
      next.sales = await Promise.all(
        (next.sales as Row[]).map(async (sale) => {
          try {
            const detail = await request<{ data: Row }>(
              `/api/sales/${sale.id}`,
              token,
            );
            return { ...sale, ...detail.data };
          } catch {
            return sale;
          }
        }),
      );
      const allocationSets = await Promise.all(
        (next.farmers as Row[]).map((farmer) =>
          request<{ data: Row }>(`/api/statements/farmer/${farmer.id}`, token)
            .then((result) =>
              result.data.allocations.map((allocation: Row) => ({
                ...allocation,
                farmer_name: farmer.full_name,
                farmer_code: farmer.farmer_code,
                farmer_id: farmer.id,
              })),
            )
            .catch(() => []),
        ),
      );
      next.allocations = allocationSets.flat();
      setData(next);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not load cooperative records.",
      );
    } finally {
      setBusy(false);
    }
  }, [token]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    const expired = () => onLogout();
    window.addEventListener("mavuno-session-expired", expired);
    return () => window.removeEventListener("mavuno-session-expired", expired);
  }, [onLogout]);

  async function submit(
    event: FormEvent<HTMLFormElement>,
    path: string,
    payload: Row,
    after: () => void,
  ) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const result = await request<{ data: any; message?: string }>(
        path,
        token,
        { method: "POST", body: JSON.stringify(payload) },
      );
      setSuccess(result.message || "Record saved successfully.");
      after();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save this record.");
    } finally {
      setSaving(false);
    }
  }
  async function openFarmer(farmer: Row) {
    setBusy(true);
    setFarmerRecord(null);
    try {
      const [statement, deliveries] = await Promise.all([
        request<{ data: Row }>(`/api/statements/farmer/${farmer.id}`, token),
        request<{ data: Row[] }>(
          `/api/deliveries?farmerId=${farmer.id}`,
          token,
        ),
      ]);
      setFarmerRecord({ ...statement.data, deliveries: deliveries.data });
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not load farmer record.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function openBatch(batch: Row) {
    setBusy(true);
    setBatchRecord(null);
    try {
      const result = await request<{ data: Row }>(
        `/api/batches/${batch.id}`,
        token,
      );
      setBatchRecord(result.data);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not load batch details.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function anchorAuditEvent(auditEventId: string) {
    setError("");
    setSuccess("");
    setAnchoring(auditEventId);
    try {
      const ethereum = (window as Window & { ethereum?: any }).ethereum;
      if (!ethereum)
        throw new Error(
          "MetaMask was not detected. Connect the authorized recorder wallet first.",
        );
      const provider = new BrowserProvider(ethereum);
      await provider.send("eth_requestAccounts", []);
      const network = await provider.getNetwork();
      if (network.chainId !== 11155111n)
        throw new Error(
          "Switch MetaMask to Ethereum Sepolia before anchoring.",
        );
      const prepared = await request<{ data: Row }>(
        `/api/audit-blockchain/${auditEventId}/hash`,
        token,
      );
      const proof = prepared.data;
      const contract = new Contract(
        proof.contractAddress,
        ["function anchorEvent(bytes32 eventHash, string eventType)"],
        await provider.getSigner(),
      );
      const tx = await contract.anchorEvent(proof.eventHash, proof.eventType);
      setSuccess("Transaction submitted. Waiting for Sepolia confirmation…");
      await tx.wait();
      const confirmation = await request<{ message: string }>(
        `/api/audit-blockchain/${auditEventId}/confirm`,
        token,
        { method: "POST", body: JSON.stringify({ transactionHash: tx.hash }) },
      );
      setSuccess(
        confirmation.message || "Blockchain proof verified and saved.",
      );
      await load();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not anchor this audit event.",
      );
    } finally {
      setAnchoring("");
    }
  }
  const stats = data.dashboard || {};
  const activeBatches = (data.batches || []).filter((item: Row) =>
    ["open", "active", "in_progress"].includes(item.status),
  ).length;
  const allocationTotal = (data.allocations || [])
    .filter((x: Row) => x.status === "approved")
    .reduce((sum: number, x: Row) => sum + Number(x.net_amount_rwf), 0);
  const navTitle = nav.find((item) => item.id === section)?.label || "Overview";

  return (
    <div className="staff-app">
      <aside className="sidebar">
        <div className="sidebar-header">
          <Brand />
        </div>
        <nav className="sidebar-nav" role="navigation" aria-label="Main navigation">
          {nav.map((item) => (
            <button
              key={item.id}
              onClick={() => {
                setSection(item.id);
                setFarmerRecord(null);
                setBatchRecord(null);
                setReceipt(null);
              }}
              className={`sidebar-nav-item ${section === item.id ? 'active' : ''}`}
              aria-current={section === item.id ? 'page' : undefined}
            >
              <StaffNavIcon id={item.id} className="sidebar-nav-icon" />
              {item.label}
              {item.id === "deliveries" && <ChevronRight size={16} strokeWidth={2} aria-hidden="true" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="coop-info">
            <div className="coop-mark">K</div>
            <div className="coop-name">
              <strong>Cooperative workspace</strong>
              <small>Sepolia · Connected</small>
            </div>
            <button
              className="btn btn-ghost btn-icon"
              aria-label="Sign out"
              onClick={onLogout}
            >
              <LogOut size={18} strokeWidth={2} aria-hidden="true" />
            </button>
          </div>
        </div>
      </aside>
      <div className="staff-main">
        <header className="topbar">
          <nav className="breadcrumb" aria-label="Breadcrumb">
            <span className="breadcrumb-item">
              <span className="breadcrumb-link">Workspace</span>
              <ChevronRight size={14} strokeWidth={2} className="breadcrumb-separator" aria-hidden="true" />
            </span>
            <span className="breadcrumb-item">
              <strong className="breadcrumb-current">{navTitle}</strong>
            </span>
          </nav>
          <div className="flex items-center gap-3">
            <span className="network-tag">
              <span className="status-dot" style={{background: 'var(--color-success-500)'}} aria-hidden="true" />
              SEPOLIA TESTNET
            </span>
            <div className="avatar">{String(identity.walletAddress || "S").slice(2, 4).toUpperCase()}</div>
            <div className="text-right hidden sm:block">
              <p className="text-caption font-medium">Cooperative staff</p>
              <p className="text-micro text-secondary font-mono">
                {String(identity.walletAddress || "").slice(0, 6)}…{String(identity.walletAddress || "").slice(-4)}
              </p>
            </div>
          </div>
        </header>
        <main className="workspace">
          <div className="page-header">
            <div className="page-header-content">
              <div className="page-header-eyebrow">
                {new Date()
                  .toLocaleDateString("en-GB", {
                    weekday: "long",
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })
                  .toUpperCase()}{" "}
                <span aria-hidden="true">·</span> RWANDA COOPERATIVE
              </div>
              <h1 className="page-header-title">
                {section === "overview" ? "Cooperative Dashboard" : navTitle}
              </h1>
              <p className="page-header-subtitle">
                {section === "overview"
                  ? "Track deliveries, batches, sales, allocations and payments."
                  : sectionCopy(section)}
              </p>
            </div>
            <div className="page-header-actions flex items-center gap-3">
              <button
                className="btn btn-secondary"
                onClick={() => void load()}
                disabled={busy}
              >
                <RefreshCw size={16} strokeWidth={2} className={busy ? 'animate-spin' : ''} aria-hidden="true" />
                Refresh
              </button>
              {section === "deliveries" && (
                <button
                  className="btn btn-primary"
                  onClick={() => {
                    setReceipt(null);
                    setShowDeliveryForm(true);
                  }}
                >
                  <Plus size={16} strokeWidth={2} aria-hidden="true" />
                  Record Delivery
                </button>
              )}
            </div>
          </div>
          {error && (
            <div className="alert alert-error" role="alert">
              <AlertCircle className="alert-icon" size={20} strokeWidth={2} aria-hidden="true" />
              <div className="alert-content">
                <p className="alert-message">{error}</p>
              </div>
              <button className="alert-dismiss" onClick={() => setError("")} aria-label="Dismiss">
                <X size={18} strokeWidth={2} aria-hidden="true" />
              </button>
            </div>
          )}
          {success && (
            <div className="alert alert-success" role="status">
              <CheckCircle className="alert-icon" size={20} strokeWidth={2} aria-hidden="true" />
              <div className="alert-content">
                <p className="alert-message">{success}</p>
              </div>
              <button className="alert-dismiss" onClick={() => setSuccess("")} aria-label="Dismiss">
                <X size={18} strokeWidth={2} aria-hidden="true" />
              </button>
            </div>
          )}
          {busy && (
            <div className="alert alert-info mb-4">
              <Loader2 className="alert-icon animate-spin" size={20} strokeWidth={2} aria-hidden="true" />
              <div className="alert-content">
                <p className="alert-message">Syncing cooperative records…</p>
              </div>
            </div>
          )}
          {!busy && section === "overview" && (
            <>
              <section className="dashboard-welcome">
                <div>
                  <span className="eyebrow">COOPERATIVE SNAPSHOT</span>
                  <h2>Your harvest, at a glance.</h2>
                  <p>
                    Track contributions, follow the movement of each harvest,
                    and keep cooperative records visible.
                  </p>
                </div>
                <div className="dashboard-season">
                  <span className="season-dot" />
                  <span>Cooperative workspace</span>
                </div>
              </section>

              <section className="stats-grid dashboard-stats">
                {[
                  {
                    label: "Registered farmers",
                    value: Number(stats.totalFarmers || 0).toLocaleString(),
                    note: "Member records",
                    icon: "♧",
                    color: "forest",
                  },
                  {
                    label: "Harvest received",
                    value: kg(stats.totalDeliveredKg),
                    note: `${Number(stats.totalDeliveries || 0).toLocaleString()} delivery records`,
                    icon: "⇣",
                    color: "gold",
                  },
                  {
                    label: "Active batches",
                    value: activeBatches.toLocaleString(),
                    note: `${stats.totalBatches || 0} batches in all`,
                    icon: "▦",
                    color: "lavender",
                  },
                  {
                    label: "Recorded sales",
                    value: money(stats.totalSalesRwf),
                    note: `${stats.totalSales || 0} buyer transactions`,
                    icon: "↗",
                    color: "blue",
                  },
                ].map((item) => (
                  <article
                    className="stat-card dashboard-stat"
                    key={item.label}
                  >
                    <div className={`stat-icon ${item.color}`}>{item.icon}</div>
                    <span>{item.label}</span>
                    <strong>{item.value}</strong>
                    <small>{item.note}</small>
                  </article>
                ))}
              </section>

              <div className="dashboard-main-grid">
                <section className="panel dashboard-journey">
                  <div className="panel-head">
                    <div>
                      <span className="eyebrow">THE COOPERATIVE PROCESS</span>
                      <h2>Every harvest has a journey</h2>
                    </div>
                    <span className="soft-tag">5 KEY STAGES</span>
                  </div>

                  <p className="dashboard-intro">
                    Follow how a farmer's delivery moves through collection,
                    sale and payment recording.
                  </p>

                  <div className="dashboard-process">
                    {[
                      ["01", "Delivery", "Weighed and receipted"],
                      ["02", "Batch", "Grouped by grade"],
                      ["03", "Sale", "Buyer proceeds recorded"],
                      ["04", "Allocation", "Farmer shares calculated"],
                      ["05", "Payment", "Payment entries tracked"],
                    ].map(([number, label, note], index) => (
                      <div className="dashboard-process-step" key={number}>
                        <span
                          className={`dashboard-process-number step-${index}`}
                        >
                          {number}
                        </span>
                        <div>
                          <strong>{label}</strong>
                          <small>{note}</small>
                        </div>
                        {index < 4 && (
                          <span className="dashboard-process-arrow">→</span>
                        )}
                      </div>
                    ))}
                  </div>

                  <div className="dashboard-note">
                    <span>ⓘ</span>
                    <p>
                      Blockchain anchors can provide tamper-evident evidence
                      that a record was submitted. They do not independently
                      verify the physical delivery or payment.
                    </p>
                  </div>

                  <button
                    className="button outline dashboard-action"
                    onClick={() => setSection("deliveries")}
                  >
                    Explore delivery records <span>→</span>
                  </button>
                </section>

                <section className="panel dashboard-allocation">
                  <div className="panel-head">
                    <div>
                      <span className="eyebrow">FARMER ALLOCATIONS</span>
                      <h2>Sharing sale proceeds</h2>
                    </div>
                    <span className="soft-tag">APPROVED</span>
                  </div>

                  <div className="dashboard-allocation-total">
                    {money(stats.totalAllocatedRwf ?? allocationTotal)}
                    <small>Total allocated to farmers</small>
                  </div>

                  <div className="dashboard-allocation-rule">
                    <span className="dashboard-rule-icon">÷</span>
                    <div>
                      <strong>How the share is calculated</strong>
                      <p>
                        A farmer's eligible quantity is compared with the
                        quantity sold from the batch. Applicable deductions are
                        applied before net allocations are assigned.
                      </p>
                    </div>
                  </div>

                  <button
                    className="button outline full"
                    onClick={() => setSection("allocations")}
                  >
                    Review allocations <span>→</span>
                  </button>
                </section>
              </div>

              <section className="panel recent-panel dashboard-recent">
                <div className="panel-head">
                  <div>
                    <span className="eyebrow">LATEST ACTIVITY</span>
                    <h2>Recent deliveries</h2>
                    <p className="dashboard-panel-description">
                      The latest harvest contributions recorded by the
                      cooperative.
                    </p>
                  </div>
                  <button
                    className="text-button"
                    onClick={() => setSection("deliveries")}
                  >
                    View all deliveries →
                  </button>
                </div>

                <Table
                  headers={[
                    "DELIVERY",
                    "FARMER",
                    "DATE",
                    "QUANTITY",
                    "GRADE",
                    "STATUS",
                  ]}
                  rows={(data.deliveries || [])
                    .slice(0, 5)
                    .map((d: Row) => [
                      d.delivery_reference,
                      farmerName(d.farmer_id, data.farmers),
                      date(d.delivered_at),
                      kg(d.quantity_kg),
                      `Grade ${d.grade}`,
                      <Status status={d.status} />,
                    ])}
                  empty="No deliveries yet. Record the first harvest to begin the journey."
                />
              </section>

              <section className="dashboard-financial-strip">
                <div>
                  <span>Payments recorded</span>
                  <strong>{money(stats.totalPaymentsRwf)}</strong>
                </div>
                <div>
                  <span>Outstanding balance</span>
                  <strong>{money(stats.outstandingRwf)}</strong>
                </div>
                <p>
                  Payment entries are records of progress; they do not transfer
                  funds.
                </p>
              </section>
            </>
          )}
          {!busy && section === "farmers" && (
            <section className="panel data-panel">
              <div className="panel-head">
                <div>
                  <div className="eyebrow">MEMBER DIRECTORY</div>
                  <h2>{data.farmers?.length || 0} registered farmers</h2>
                </div>
                <SearchBox
                  placeholder="Search name or farmer code"
                  value={searchTerm}
                  onChange={setSearchTerm}
                />
              </div>
              {farmerRecord ? (
                <FarmerDetail
                  record={farmerRecord}
                  onBack={() => setFarmerRecord(null)}
                />
              ) : (
                <Table
                  headers={[
                    "FARMER",
                    "FARMER CODE",
                    "LOCATION",
                    "PHONE",
                    "STATUS",
                    "",
                  ]}
                  rows={(data.farmers || [])
                    .filter((f: Row) =>
                      `${f.full_name} ${f.farmer_code} ${f.village} ${f.district}`
                        .toLowerCase()
                        .includes(searchTerm.toLowerCase()),
                    )
                    .map((f: Row) => [
                      `<farmer>${f.full_name}`,
                      f.farmer_code,
                      [f.village, f.district].filter(Boolean).join(", ") || "—",
                      f.phone || "—",
                      <Status status={f.status} />,
                      <button
                        className="row-action"
                        onClick={() => void openFarmer(f)}
                      >
                        View record →
                      </button>,
                    ])}
                  empty="No farmers are registered yet."
                />
              )}
            </section>
          )}

          {!busy &&
            section === "deliveries" &&
            (receipt ? (
              <DeliveryReceipt
                receipt={receipt}
                onBack={() => setReceipt(null)}
                onNew={() => {
                  setReceipt(null);
                  setShowDeliveryForm(true);
                }}
              />
            ) : (
              <section className="deliveries-page">
                <div className="deliveries-heading">
                  <div>
                    <span className="eyebrow">HARVEST COLLECTION</span>
                    <h2>Delivery records</h2>
                    <p>
                      Track every harvest contribution received by the
                      cooperative.
                    </p>
                  </div>

                  <button
                    className="button primary deliveries-create-button"
                    onClick={() => setShowDeliveryForm(true)}
                  >
                    <Plus size={18} strokeWidth={2} aria-hidden="true" />
                    Record delivery
                  </button>
                </div>

                <div className="deliveries-summary">
                  <article className="deliveries-summary-card">
                    <span className="deliveries-icon green">
                      <Truck size={24} strokeWidth={2} aria-hidden="true" />
                    </span>
                    <div>
                      <span>Total recorded deliveries</span>
                      <strong>
                        {(data.deliveries || []).length.toLocaleString()}
                      </strong>
                      <small>Delivery records in the system</small>
                    </div>
                  </article>

                  <article className="deliveries-summary-card">
                    <span className="deliveries-icon gold">
                      <Package size={24} strokeWidth={2} aria-hidden="true" />
                    </span>
                    <div>
                      <span>Total harvest received</span>
                      <strong>
                        {kg(
                          (data.deliveries || []).reduce(
                            (total: number, delivery: Row) =>
                              total + Number(delivery.quantity_kg || 0),
                            0,
                          ),
                        )}
                      </strong>
                      <small>Combined quantity recorded</small>
                    </div>
                  </article>

                  <article className="deliveries-summary-card deliveries-summary-tip">
                    <span className="deliveries-icon neutral">
                      <Shield size={24} strokeWidth={2} aria-hidden="true" />
                    </span>
                    <div>
                      <span>Keep records up to date</span>
                      <p>
                        Record each delivery carefully so its journey can be
                        followed through the cooperative.
                      </p>
                    </div>
                  </article>
                </div>

                <section className="panel data-panel deliveries-table-panel">
                  <div className="panel-head">
                    <div>
                      <span className="eyebrow">COLLECTION REGISTER</span>
                      <h2>
                        {(data.deliveries || []).length.toLocaleString()}{" "}
                        recorded deliveries
                      </h2>
                      <p className="deliveries-table-description">
                        Search and review farmer harvest contributions.
                      </p>
                    </div>

                    <SearchBox
                      placeholder="Search reference or farmer"
                      value={searchTerm}
                      onChange={setSearchTerm}
                    />
                  </div>

                  <Table
                    headers={[
                      "DELIVERY REFERENCE",
                      "FARMER",
                      "DELIVERED",
                      "QUANTITY",
                      "GRADE",
                      "STATUS",
                    ]}
                    rows={(data.deliveries || [])
                      .filter((d: Row) =>
                        `${d.delivery_reference} ${farmerName(d.farmer_id, data.farmers)}`
                          .toLowerCase()
                          .includes(searchTerm.toLowerCase()),
                      )
                      .map((d: Row) => [
                        d.delivery_reference,
                        farmerName(d.farmer_id, data.farmers),
                        date(d.delivered_at),
                        kg(d.quantity_kg),
                        `Grade ${d.grade}`,
                        <Status status={d.status} />,
                      ])}
                    empty="No deliveries yet. Select 'Record delivery' to create the first receipt."
                  />
                </section>
              </section>
            ))}

          {!busy &&
            section === "batches" &&
            (batchRecord ? (
              <BatchDetail
                record={batchRecord}
                deliveries={data.deliveries || []}
                farmers={data.farmers || []}
                onBack={() => setBatchRecord(null)}
              />
            ) : (
              <section className="batches-page">
                <div className="batches-heading">
                  <div>
                    <div className="eyebrow">COLLECTION & GRADING</div>
                    <h1>Batch inventory</h1>
                    <p>
                      Organise recorded deliveries into batches and track their
                      progress through the cooperative.
                    </p>
                  </div>

                  <button
                    className="button primary batches-create"
                    onClick={() => setShowBatchForm(true)}
                  >
                    <span aria-hidden="true">＋</span>
                    Create batch
                  </button>
                </div>

                <div className="batches-summary">
                  <div className="batch-summary-card">
                    <div className="batch-summary-icon">
                      <Package size={28} strokeWidth={2} aria-hidden="true" />
                    </div>
                    <div>
                      <span>Total batches</span>
                      <strong>{data.batches?.length || 0}</strong>
                      <small>Recorded in the cooperative</small>
                    </div>
                  </div>

                  <div className="batch-summary-card">
                    <div className="batch-summary-icon quantity">
                      <Scale size={28} strokeWidth={2} aria-hidden="true" />
                    </div>
                    <div>
                      <span>Total batch quantity</span>
                      <strong>
                        {kg(
                          (data.batches || []).reduce(
                            (total: number, batch: Row) =>
                              total + (Number(batch.deliveredQuantityKg) || 0),
                            0,
                          ),
                        )}
                      </strong>
                      <small>Combined recorded quantity</small>
                    </div>
                  </div>

                  <div className="batch-summary-card">
                    <div className="batch-summary-icon deliveries">
                      <ClipboardList size={28} strokeWidth={2} aria-hidden="true" />
                    </div>
                    <div>
                      <span>Deliveries in batches</span>
                      <strong>
                        {(data.batches || []).reduce(
                          (total: number, batch: Row) =>
                            total + (Number(batch.deliveryCount) || 0),
                          0,
                        )}
                      </strong>
                      <small>Individual delivery records</small>
</div>
              </div>

              </div>

                <section className="panel data-panel batches-table-panel">
                  <div className="panel-head">
                    <div>
                      <div className="eyebrow">BATCH REGISTER</div>
                      <h2>All batches ({data.batches?.length || 0})</h2>
                    </div>
                  </div>

                  <Table
                    headers={[
                      "BATCH",
                      "GRADE",
                      "DELIVERIES",
                      "TOTAL QUANTITY",
                      "CREATED",
                      "STATUS",
                      "",
                    ]}
                    rows={(data.batches || []).map((b: Row) => [
                      b.batchReference,
                      `Grade ${b.grade}`,
                      `${b.deliveryCount} deliveries`,
                      kg(b.deliveredQuantityKg),
                      date(b.createdAt),
                      <Status status={b.status} />,
                      <button
                        className="row-action"
                        onClick={() => void openBatch(b)}
                      >
                        View contents →
                      </button>,
                    ])}
                    empty="No batches yet. Record a delivery, then create a batch from eligible deliveries."
                  />
                </section>
              </section>
            ))}

          {!busy && section === "sales" && (
            <section className="panel data-panel">
              <div className="panel-head">
                <div>
                  <div className="eyebrow">BUYER TRANSACTIONS</div>
                  <h2>{data.sales?.length || 0} recorded sales</h2>
                </div>
                <button
                  className="button primary"
                  onClick={() => setShowSaleForm(true)}
                >
                  ＋ Record buyer sale
                </button>
              </div>
            {selectedSale ? (
  <div className="sale-detail">
    <button
      type="button"
      onClick={() => setSelectedSale(null)}
    >
      ← Back to Buyer Sales
    </button>

    <h2>
      Sale Details — {selectedSale.sale_reference}
    </h2>

    <p>
      Status: {selectedSale.status}
    </p>

    <div className="sale-summary">
      <p>
        Gross: {Number(selectedSale.gross_amount_rwf).toLocaleString()} RWF
      </p>

      <p>
        Deductions: {Number(selectedSale.deductions_rwf).toLocaleString()} RWF
      </p>

      <p>
        Net proceeds: {Number(selectedSale.net_amount_rwf).toLocaleString()} RWF
      </p>
    </div>

    <h3>Farmer Allocations</h3>

    {(selectedSale.items ?? []).flatMap((item: Row) =>
      (item.allocations ?? []).map((allocation: Row) => (
        <div key={allocation.id}>
          <p>
            {allocation.farmer_name} ({allocation.farmer_code})
          </p>

          <p>
            Allocated: {Number(allocation.net_amount_rwf).toLocaleString()} RWF
          </p>

          <p>
            Paid (recorded): {Number(allocation.paidRwf).toLocaleString()} RWF
          </p>

          <p>
            Outstanding: {Number(allocation.outstandingRwf).toLocaleString()} RWF
          </p>
        </div>
      ))
    )}

    <h3>Reconciliation</h3>

    <p>
      Sale net: {Number(selectedSale.reconciliation?.saleNetRwf ?? 0).toLocaleString()} RWF
    </p>

    <p>
      Total allocated: {Number(selectedSale.reconciliation?.totalAllocatedRwf ?? 0).toLocaleString()} RWF
    </p>

    <p>
      Unallocated: {Number(selectedSale.reconciliation?.unallocatedRwf ?? 0).toLocaleString()} RWF
    </p>

    <p>
      Total payments recorded: {Number(selectedSale.reconciliation?.totalPaidRwf ?? 0).toLocaleString()} RWF
    </p>

    <p>
      Outstanding: {Number(selectedSale.reconciliation?.outstandingRwf ?? 0).toLocaleString()} RWF
    </p>

    <small>
      Payment records indicate amounts entered into the cooperative's records;
      they do not independently confirm receipt by farmers.
    </small>
  </div>
) : (
  <Table
    headers={[
      "SALE REFERENCE",
      "BUYER",
      "BATCH",
      "QUANTITY SOLD",
      "GROSS",
      "DEDUCTIONS",
      "NET PROCEEDS",
      "STATUS"
    ]}
    rows={(data.sales || []).map((s: Row) => {
      const item = s.items?.[0];
                  return [
                    s.sale_reference,
                    buyerName(s.buyer_id, data.buyers),
                    (data.batches || []).find(
                      (b: Row) => b.id === item?.batch_id,
                    )?.batchReference || "—",
                    kg(s.totalQuantityKg ?? item?.quantity_kg),
                    money(s.gross_amount_rwf),
                    money(s.deductions_rwf),
                    money(s.net_amount_rwf),
                    <Status status={s.status} />,
                  ];

    })}
    empty="No buyer sales recorded. Sell a batch to calculate farmer allocations."
    onRowClick={(index) => {
      setSelectedSale(data.sales[index]);
    }}
  />
)}
</section>
          )}
          {!busy && section === "allocations" && (
            <section className="panel data-panel">
              <div className="panel-head">
                <div>
                  <div className="eyebrow">SALE PROCEEDS SHARED</div>
                  <h2>{money(allocationTotal)} total approved</h2>
                </div>
                <span className="basis-note">
                  Eligible quantity ÷ sold batch quantity × net proceeds
                </span>
              </div>
              <Table
                headers={[
                  "FARMER",
                  "ELIGIBLE QTY",
                  "CONTRIBUTION SHARE",
                  "GROSS SHARE",
                  "DEDUCTIONS",
                  "NET ALLOCATION",
                  "STATUS",
                ]}
                rows={(data.allocations || []).map((a: Row) => [
                  <>
                    <strong>{a.farmer_name}</strong>
                    <small>{a.farmer_code}</small>
                  </>,
                  kg(a.eligible_quantity_kg),
                  `${(Number(a.contribution_share) * 100).toFixed(1)}%`,
                  money(a.gross_amount_rwf),
                  money(a.deductions_rwf),
                  money(a.net_amount_rwf),
                  <Status status={a.status} />,
                ])}
                empty="Allocations are generated when a sale is recorded against a batch."
              />
              <div className="table-note">
                Share = farmer's eligible batch quantity ÷ total quantity sold
                from the batch. Each share is applied to sale proceeds after
                deductions.
              </div>
            </section>
          )}
          {!busy && section === "payments" && (
            <section className="panel data-panel">
              <div className="panel-head">
                <div>
                  <div className="eyebrow">SIMULATED PAYMENT RECORDS</div>
                  <h2>{data.payments?.length || 0} payment entries</h2>
                </div>
                <button
                  className="button primary"
                  onClick={() => setShowPaymentForm(true)}
                >
                  ＋ Record payment
                </button>
              </div>
              <div className="simulated-banner">
                <span>ⓘ</span> These entries document payment progress only. No
                money is transferred by MavunoTrail.
              </div>
              <Table
                headers={[
                  "PAYMENT REFERENCE",
                  "FARMER",
                  "ALLOCATION",
                  "AMOUNT",
                  "METHOD",
                  "DATE",
                  "STATUS",
                ]}
                rows={(data.payments || []).map((p: Row) => {
                  const allocation = (data.allocations || []).find(
                    (a: Row) => a.id === p.allocation_id,
                  );
                  return [
                    p.payment_reference,
                    allocation?.farmer_name || "Farmer record",
                    String(p.allocation_id).slice(0, 8),
                    money(p.amount_rwf),
                    title(p.payment_method),
                    date(p.payment_date),
                    <Status status={p.status} />,
                  ];
                })}
                empty="No payment entries yet."
              />
            </section>
          )}
          {!busy && section === "audit" && (
            <section className="panel data-panel">
              <div className="panel-head">
                <div>
                  <div className="eyebrow">TAMPER-EVIDENT EVENT HISTORY</div>
                  <h2>{data.audits?.length || 0} audit events</h2>
                </div>
                <span className="network-tag">
                  <span className="status-dot" style={{background: 'var(--color-success-500)'}} aria-hidden="true" />
                  SEPOLIA
                </span>
              </div>
              <div className="simulated-banner">
                <span>ⓘ</span> A blockchain proof confirms that an event hash
                was anchored. It does not prove the original physical weight,
                sale, or payment was accurate.
              </div>
              <Table
                headers={[
                  "EVENT",
                  "RECORD TYPE",
                  "RECORD ID",
                  "RECORDED",
                  "VERIFICATION",
                  "TRANSACTION",
                ]}
                rows={(data.audits || []).map((a: Row) => {
                  const anchor = Array.isArray(a.audit_event_anchors)
                    ? a.audit_event_anchors[0]
                    : a.audit_event_anchors;
                  return [
                    title(a.event_type),
                    title(a.entity_type),
                    String(a.entity_id).slice(0, 10),
                    date(a.recorded_at),
                    anchor ? (
                      <Status status="verified on chain" />
                    ) : (
                      <Status status="not anchored" />
                    ),
                    anchor?.transaction_hash ? (
                      <a
                        className="hash-link"
                        href={`https://sepolia.etherscan.io/tx/${anchor.transaction_hash}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {String(anchor.transaction_hash).slice(0, 10)}… ↗
                      </a>
                    ) : (
                      <button
                        className="row-action"
                        disabled={anchoring === a.id}
                        onClick={() => void anchorAuditEvent(a.id)}
                      >
                        {anchoring === a.id
                          ? "Anchoring…"
                          : "Anchor with MetaMask"}
                      </button>
                    ),
                  ];
                })}
                empty="Audit events will appear here when records are created."
              />
            </section>
          )}
        </main>
      </div>

      {showDeliveryForm && (
        <Modal
          title="Record a potato delivery"
          close={() => setShowDeliveryForm(false)}
        >
          <form
            onSubmit={(e) => {
              const form = new FormData(e.currentTarget);
              const farmer = (data.farmers || []).find(
                (x: Row) => x.id === form.get("farmerId"),
              );
              const quantityKg = Number(form.get("quantityKg"));

              const payload: Record<string, any> = {
                farmerId: form.get("farmerId"),
                collectionCentreId: form.get("collectionCentreId"),
                deliveryReference: form.get("deliveryReference"),
                deliveredAt: form.get("deliveredAt"),
                quantityKg,
                grade: form.get("grade"),
                notes: form.get("notes"),
              };

              void submit(e, "/api/deliveries", payload, () => {
                const receiptObj: Row = {
                  delivery_reference: payload.deliveryReference,
                  delivered_at: payload.deliveredAt,
                  quantity_kg: quantityKg,
                  grade: payload.grade,
                  farmer_name: farmer?.full_name,
                  farmer_code: farmer?.farmer_code,
                  collection_name: (data.centres || []).find(
                    (c: Row) => c.id === payload.collectionCentreId,
                  )?.name,
                  status: "recorded",
                };

                setReceipt(receiptObj);
                setShowDeliveryForm(false);
              });
            }}
          >
            <div className="delivery-form-intro">
              <span className="delivery-form-intro-icon">
                <Truck size={24} strokeWidth={2} aria-hidden="true" />
              </span>
              <p>
                Enter the harvest details carefully. These details will be used
                to create the delivery record and receipt.
              </p>
            </div>

            <div className="delivery-form-section-heading">
              <span className="delivery-form-section-icon">
                <Users size={24} strokeWidth={2} aria-hidden="true" />
              </span>
              <div>
                <strong>Farmer and collection centre</strong>
                <small>
                  Identify who delivered the harvest and where it was received.
                </small>
              </div>
            </div>

            <div className="form-grid delivery-form-grid">
              <Field label="Farmer" name="farmerId" required>
                <option value="">Select a farmer</option>
                {(data.farmers || [])
                  .filter((f: Row) => f.status === "active")
                  .map((f: Row) => (
                    <option value={f.id} key={f.id}>
                      {f.full_name} · {f.farmer_code}
                    </option>
                  ))}
              </Field>

              <Field
                label="Collection centre"
                name="collectionCentreId"
                required
              >
                <option value="">Select collection centre</option>
                {(data.centres || []).map((c: Row) => (
                  <option value={c.id} key={c.id}>
                    {c.name}
                  </option>
                ))}
              </Field>
            </div>

            <div className="delivery-form-section-heading">
              <span className="delivery-form-section-icon gold">
                <Package size={24} strokeWidth={2} aria-hidden="true" />
              </span>
              <div>
                <strong>Delivery details</strong>
                <small>
                  Record the reference, date, quantity and potato grade.
                </small>
              </div>
            </div>

            <div className="form-grid delivery-form-grid">
              <label>
                Delivery reference
                <input
                  name="deliveryReference"
                  required
                  placeholder="e.g. MT-D-2026-0142"
                />
              </label>

              <label>
                Date received
                <input
                  type="date"
                  name="deliveredAt"
                  required
                  defaultValue={new Date().toISOString().slice(0, 10)}
                />
              </label>

              <label className="delivery-quantity-field">
                Quantity (kg)
                <input
                  name="quantityKg"
                  required
                  type="number"
                  min="0.1"
                  step="0.1"
                  placeholder="0.0"
                />
                <small>Enter the measured harvest quantity in kilograms.</small>
              </label>

              <Field label="Grade" name="grade" required>
                <option>A</option>
                <option>B</option>
                <option>C</option>
              </Field>

              <label className="span-2 delivery-notes-field">
                Notes <span className="optional">OPTIONAL</span>
                <textarea
                  name="notes"
                  rows={3}
                  placeholder="Add relevant observations about this delivery..."
                />
              </label>
            </div>

            <div className="delivery-form-footnote">
              <Info size={20} strokeWidth={2} aria-hidden="true" />
              <p>
                Review the details before submitting. The receipt will summarize
                the information entered in this form.
              </p>
            </div>

            <ModalButtons
              loading={saving}
              onCancel={() => setShowDeliveryForm(false)}
            />
          </form>
        </Modal>
      )}

      {showBatchForm && (
        <Modal
          title="Create a collection batch"
          close={() => setShowBatchForm(false)}
        >
          <form
            onSubmit={(e) => {
              const form = new FormData(e.currentTarget);
              const ids = form.getAll("deliveryIds").map(String);
              const grade = String(form.get("grade"));
              const payload: Record<string, any> = {
                batchReference: form.get("batchReference"),
                grade,
                deliveries: ids.map((id) => ({
                  deliveryId: id,
                  quantityKg: Number(
                    (data.deliveries || []).find((d: Row) => d.id === id)
                      ?.availableQuantityKg ?? 0,
                  ),
                })),
              };
              void submit(e, "/api/batches", payload, () =>
                setShowBatchForm(false),
              );
            }}
          >
            <div className="form-grid">
              <label className="span-2">
                Batch reference
                <input
                  name="batchReference"
                  required
                  placeholder="e.g. MT-B-2026-008"
                />
              </label>
              <label>
                Grade
                <select
                  name="grade"
                  required
                  value={batchGrade}
                  onChange={(e) => setBatchGrade(e.target.value)}
                >
                  <option>A</option>
                  <option>B</option>
                  <option>C</option>
                </select>
              </label>
              <div className="span-2">
                <span className="field-label">
                  Unassigned deliveries · Grade {batchGrade}
                </span>
                <div className="select-list">
                  {(data.deliveries || [])
                    .filter(
                      (d: Row) =>
                        d.status === "recorded" &&
                        d.grade === batchGrade &&
                        Number(d.availableQuantityKg ?? 0) > 0,
                    )
                    .map((d: Row) => (
                      <label className="check-row" key={d.id}>
                        <input
                          type="checkbox"
                          name="deliveryIds"
                          value={d.id}
                        />
                        <span>
                          {d.delivery_reference} ·{" "}
                          {farmerName(d.farmer_id, data.farmers)}
                        </span>
                        <small>{kg(d.availableQuantityKg)} available</small>
                      </label>
                    ))}
                </div>
                <small className="helper">
                  Selected deliveries will contribute their remaining unassigned
                  quantity to this batch.
                </small>
              </div>
            </div>
            <ModalButtons
              loading={saving}
              onCancel={() => setShowBatchForm(false)}
            />
          </form>
        </Modal>
      )}
      {showSaleForm && (
        <Modal title="Record buyer sale" close={() => setShowSaleForm(false)}>
          <form
            onSubmit={(e) => {
              const form = new FormData(e.currentTarget);
              const payload: Record<string, any> = {
                buyerId: form.get("buyerId"),
                saleReference: form.get("saleReference"),
                saleDate: form.get("saleDate"),
                batchId: form.get("batchId"),
                quantityKg: Number(form.get("quantityKg")),
                pricePerKgRwf: Number(form.get("pricePerKgRwf")),
                deductionsRwf: Number(form.get("deductionsRwf")),
              };
              void submit(e, "/api/sales", payload, () =>
                setShowSaleForm(false),
              );
            }}
          >
            <div className="form-grid">
              <Field label="Buyer" name="buyerId" required>
                <option value="">Select buyer</option>
                {(data.buyers || []).map((b: Row) => (
                  <option value={b.id} key={b.id}>
                    {b.name}
                  </option>
                ))}
              </Field>
              <Field label="Batch" name="batchId" required>
                <option value="">Select batch</option>
                {(data.batches || [])
                  .filter((b: Row) => b.status !== "sold")
                  .map((b: Row) => (
                    <option value={b.id} key={b.id}>
                      {b.batchReference} · Grade {b.grade} ·{" "}
                      {kg(b.deliveredQuantityKg)}
                    </option>
                  ))}
              </Field>
              <label>
                Sale reference
                <input
                  name="saleReference"
                  required
                  placeholder="e.g. MT-S-2026-021"
                />
              </label>
              <label>
                Sale date
                <input
                  name="saleDate"
                  type="date"
                  required
                  defaultValue={new Date().toISOString().slice(0, 10)}
                />
              </label>
              <label>
                Quantity sold (kg)
                <input
                  name="quantityKg"
                  type="number"
                  step="0.1"
                  min="0.1"
                  required
                />
              </label>
              <label>
                Price per kg (FRW)
                <input name="pricePerKgRwf" type="number" min="0" required />
              </label>
              <label className="span-2">
                Deductions (FRW)
                <input
                  name="deductionsRwf"
                  type="number"
                  min="0"
                  defaultValue="0"
                  required
                />
              </label>
            </div>
            <div className="form-info">
              The sale endpoint calculates each farmer's allocation using their
              eligible quantity in the batch.
            </div>
            <ModalButtons
              loading={saving}
              onCancel={() => setShowSaleForm(false)}
            />
          </form>
        </Modal>
      )}
      {showPaymentForm && (
        <Modal
          title="Record a simulated payment"
          close={() => setShowPaymentForm(false)}
        >
          <form
            onSubmit={(e) => {
              const form = new FormData(e.currentTarget);
              const payload: Record<string, any> = {
                allocationId: form.get("allocationId"),
                amountRwf: Number(form.get("amountRwf")),
                paymentMethod: form.get("paymentMethod"),
                paymentDate: form.get("paymentDate"),
              };
              void submit(e, "/api/payments", payload, () =>
                setShowPaymentForm(false),
              );
            }}
          >
            <div className="simulated-banner">
              <span>ⓘ</span> Demonstration record only. No real money will be
              transferred.
            </div>
            <div className="form-grid">
              <Field
                label="Approved farmer allocation"
                name="allocationId"
                required
              >
                <option value="">Select farmer allocation</option>
                {(data.allocations || [])
                  .filter((a: Row) => a.status === "approved")
                  .map((a: Row) => (
                    <option value={a.id} key={a.id}>
                      {a.farmer_name} · {money(a.net_amount_rwf)}
                    </option>
                  ))}
              </Field>
              <label>
                Amount (FRW)
                <input
                  name="amountRwf"
                  type="number"
                  min="1"
                  step="1"
                  required
                />
              </label>
              <Field label="Record method" name="paymentMethod" required>
                <option value="mobile_money">Mobile money (simulated)</option>
                <option value="bank_transfer">Bank transfer (simulated)</option>
                <option value="cash">Cash record</option>
                <option value="other">Other</option>
              </Field>
              <label>
                Date recorded
                <input
                  name="paymentDate"
                  type="date"
                  required
                  defaultValue={new Date().toISOString().slice(0, 10)}
                />
              </label>
            </div>
            <ModalButtons
              loading={saving}
              onCancel={() => setShowPaymentForm(false)}
            />
          </form>
        </Modal>
      )}
    </div>
  );
}

function sectionCopy(section: Section) {
  return (
    {
      farmers:
        "Member profiles and their recorded harvest and payment information.",
      deliveries:
        "Receive and weigh harvests, then give farmers a clear receipt.",
      batches: "Group compatible delivery quantities for buyer sale.",
      sales: "Record buyer proceeds and generate farmer allocation shares.",
      allocations:
        "See how eligible batch quantities translate into each farmer's share.",
      payments:
        "Track recorded payment progress. Entries are simulated; no funds are transferred.",
      audit:
        "Review business events and the verification status of their on-chain proof.",
      overview: "",
    } as Record<Section, string>
  )[section];
}
function farmerName(id: string, farmers: Row[] = []) {
  const found = farmers.find((f) => f.id === id);
  return found?.full_name || "Farmer record";
}
function buyerName(id: string, buyers: Row[] = []) {
  return buyers.find((b) => b.id === id)?.name || "Buyer";
}
function SearchBox({
  placeholder,
  value,
  onChange,
}: {
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="search-box">
      <Search size={18} strokeWidth={2} aria-hidden="true" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}
function Status({ status }: { status: unknown }) {
  const value = String(status || "unknown");
  const verified = value.includes("verified");
  return (
    <span
      className={`status ${verified ? "status-verified" : ["recorded", "approved", "active", "sold", "closed"].includes(value) ? "status-good" : "status-neutral"}`}
    >
      <span className="status-dot" aria-hidden="true" />
      {title(value)}
    </span>
  );
}

function Table({
  headers,
  rows,
  empty,
  onRowClick,
}: {
  headers: string[];
  rows: any[][];
  empty: string;
  onRowClick?: (rowIndex: number) => void;
}) {
  return (
    <div className="table-wrap">
      {rows.length ? (
        <table>
          <thead>
            <tr>
              {headers.map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>

          <tbody>
            {rows.map((row, i) => (
              <tr
                key={i}
                onClick={onRowClick ? () => onRowClick(i) : undefined}
                onKeyDown={(event) => {
                  if (
                    onRowClick &&
                    (event.key === "Enter" || event.key === " ")
                  ) {
                    event.preventDefault();
                    onRowClick(i);
                  }
                }}
                tabIndex={onRowClick ? 0 : undefined}
                style={onRowClick ? { cursor: "pointer" } : undefined}
              >
                {row.map((item, j) => (
                  <td key={j}>
                    {typeof item === "string" && item.startsWith("<farmer>") ? (
                      <strong>{item.slice(8)}</strong>
                    ) : (
                      item
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="empty-state">
          <span>▤</span>
          <strong>Nothing recorded here yet</strong>
          <p>{empty}</p>
        </div>
      )}
    </div>
  );
}

function Modal({
  title,
  children,
  close,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
}) {
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <section className="modal">
        <header>
          <div>
            <span className="eyebrow">COOPERATIVE RECORD</span>
            <h2>{title}</h2>
          </div>
          <button className="close-button" onClick={close} aria-label="Close">
            ×
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
function Field({
  label,
  name,
  children,
  required,
}: {
  label: string;
  name: string;
  children: ReactNode;
  required?: boolean;
}) {
  return (
    <label>
      {label}
      <select name={name} required={required}>
        {children}
      </select>
    </label>
  );
}
function ModalButtons({
  loading,
  onCancel,
}: {
  loading: boolean;
  onCancel: () => void;
}) {
  return (
    <div className="modal-actions">
      <button type="button" className="button outline" onClick={onCancel}>
        Cancel
      </button>
      <button className="button primary" disabled={loading}>
        {loading ? "Saving…" : "Save record"}
      </button>
    </div>
  );
}

function DeliveryReceipt({
  receipt,
  onBack,
  onNew,
}: {
  receipt: Row;
  onBack: () => void;
  onNew: () => void;
}) {
  return (
    <section className="receipt-page">
      <div className="receipt-card">
        <div className="receipt-brand">
          <Brand large />
        </div>

        <div className="receipt-top">
          <div className="receipt-check">
            <CheckCircle size={28} strokeWidth={2.5} aria-hidden="true" />
          </div>

          <span className="eyebrow">DELIVERY RECEIPT</span>
          <h2>Harvest received</h2>
          <p>
            The delivery record has been successfully saved to the cooperative
            system.
          </p>
        </div>

        <div className="receipt-reference">
          <div>
            <span>DELIVERY REFERENCE</span>
            <strong>{receipt.delivery_reference}</strong>
          </div>
          <Status status="recorded" />
        </div>

        <div className="receipt-details">
          <div className="receipt-detail">
            <span>Farmer</span>
            <strong>{receipt.farmer_name}</strong>
            <small>{receipt.farmer_code}</small>
          </div>

          <div className="receipt-detail">
            <span>Received on</span>
            <strong>{date(receipt.delivered_at)}</strong>
          </div>

          <div className="receipt-detail">
            <span>Quantity received</span>
            <strong>{kg(receipt.quantity_kg)}</strong>
          </div>

          <div className="receipt-detail">
            <span>Harvest grade</span>
            <strong>Grade {receipt.grade}</strong>
          </div>

          <div className="receipt-detail receipt-detail-wide">
            <span>Collection centre</span>
            <strong>{receipt.collection_name || "Selected centre"}</strong>
          </div>
        </div>

        <div className="receipt-next">
          <div className="next-icon">
            <ArrowRight size={24} strokeWidth={2} aria-hidden="true" />
          </div>

          <div>
            <strong>What happens next?</strong>
            <p>
              This delivery can be added to a batch with other Grade{" "}
              {receipt.grade} harvests. When the batch is sold, the sale process
              can generate farmer allocations.
            </p>
          </div>
        </div>

<div className="receipt-audit-note">
            <Shield size={24} strokeWidth={1.7} aria-hidden="true" />
            <p>
              <strong>Recordkeeping note</strong>
              <span>
                This receipt confirms that the delivery record was saved. Any
                blockchain audit entry provides a tamper-evident history of
              submitted records; it does not independently verify the physical
              harvest.
            </span>
          </p>
        </div>

        <div className="receipt-actions">
          <button className="button outline" onClick={onBack}>
            Back to deliveries
          </button>

          <button className="button primary" onClick={onNew}>
            Record another
            <span aria-hidden="true">→</span>
          </button>
        </div>
      </div>
    </section>
  );
}

function BatchDetail({
  record,
  deliveries,
  farmers,
  onBack,
}: {
  record: Row;
  deliveries: Row[];
  farmers: Row[];
  onBack: () => void;
}) {
  const assignments = record.batch_deliveries || [];

  return (
    <section className="batch-detail-page">
      <button className="batch-back-button" onClick={onBack}>
        <ChevronLeft size={20} strokeWidth={2} aria-hidden="true" />
        Back to batches
      </button>

      <div className="batch-detail-hero">
        <div className="batch-detail-heading">
          <div className="batch-detail-icon">
            <Package size={32} strokeWidth={2} aria-hidden="true" />
          </div>

          <div className="batch-detail-title">
            <span className="eyebrow">BATCH RECORD</span>
            <h1>{record.batch_reference}</h1>
            <p>Harvest collection and delivery contributions</p>
          </div>
        </div>

        <div className="batch-detail-status">
          <span>Current status</span>
          <Status status={record.status} />
        </div>
      </div>

      <div className="batch-detail-stats">
        <div className="batch-detail-stat">
          <span>Recorded quantity</span>
          <strong>{kg(record.deliveredQuantityKg)}</strong>
          <small>Quantity assigned to this batch</small>
        </div>

        <div className="batch-detail-stat">
          <span>Delivery contributions</span>
          <strong>{assignments.length}</strong>
          <small>Deliveries included in this batch</small>
        </div>

        <div className="batch-detail-stat">
          <span>Harvest grade</span>
          <strong>Grade {record.grade}</strong>
          <small>Grade recorded for this batch</small>
        </div>
      </div>

      <section className="panel data-panel batch-contributions-panel">
        <div className="batch-section-heading">
          <div>
            <span className="eyebrow">CONTRIBUTION BREAKDOWN</span>
            <h2>Deliveries in this batch</h2>
            <p>
              See which delivery records contributed to this batch and how much
              quantity was assigned.
            </p>
          </div>

          <div className="batch-count">
            {assignments.length}{" "}
            {assignments.length === 1 ? "delivery" : "deliveries"}
          </div>
        </div>

        <Table
          headers={[
            "DELIVERY REFERENCE",
            "FARMER",
            "ASSIGNED QUANTITY",
            "ORIGINAL DELIVERY",
            "DELIVERY DATE",
          ]}
          rows={assignments.map((assignment: Row) => {
            const delivery = deliveries.find(
              (d) => d.id === assignment.delivery_id,
            );

            return [
              delivery?.delivery_reference ||
                String(assignment.delivery_id).slice(0, 10),
              delivery
                ? farmerName(delivery.farmer_id, farmers)
                : "Farmer record",
              kg(assignment.quantity_kg),
              kg(delivery?.quantity_kg),
              date(delivery?.delivered_at),
            ];
          })}
          empty="No deliveries are assigned to this batch yet."
        />
      </section>

      <div className="batch-detail-note">
        <div className="batch-note-icon">
          <AlertCircle size={24} strokeWidth={2} aria-hidden="true" />
        </div>

        <div>
          <strong>Understanding batch contributions</strong>
          <p>
            A batch is made from recorded delivery quantities. The assigned
            amount can be less than the full delivery when only part of a
            farmer's harvest is grouped. These records describe the quantities
            entered into the system; they do not independently verify physical
            stock.
          </p>
        </div>
      </div>
    </section>
  );
}

function FarmerDetail({ record, onBack }: { record: Row; onBack: () => void }) {
  const { farmer, summary, allocations, payments, deliveries } = record;
  return (
    <div className="farmer-record">
      <button className="text-button" onClick={onBack}>
        ← Back to directory
      </button>
      <div className="farmer-record-head">
        <div className="farmer-initial">
          {farmer.full_name
            .split(" ")
            .map((x: string) => x[0])
            .slice(0, 2)
            .join("")}
        </div>
        <div>
          <h2>{farmer.full_name}</h2>
          <p>
            {farmer.farmer_code} ·{" "}
            {[farmer.village, farmer.district].filter(Boolean).join(", ")}
          </p>
        </div>
        <Status status={farmer.status} />
      </div>
      <div className="record-stats">
        <span>
          Deliveries<strong>{deliveries.length}</strong>
        </span>
        <span>
          Allocated<strong>{money(summary.totalAllocatedRwf)}</strong>
        </span>
        <span>
          Paid<strong>{money(summary.totalPaidRwf)}</strong>
        </span>
        <span>
          Balance<strong>{money(summary.outstandingRwf)}</strong>
        </span>
      </div>
      <h3>Delivery history</h3>
      <Table
        headers={["REFERENCE", "DATE", "QUANTITY", "GRADE", "STATUS"]}
        rows={deliveries.map((d: Row) => [
          d.delivery_reference,
          date(d.delivered_at),
          kg(d.quantity_kg),
          `Grade ${d.grade}`,
          <Status status={d.status} />,
        ])}
        empty="No deliveries for this farmer."
      />
      <h3>
        Payment records <small>SIMULATED</small>
      </h3>
      <Table
        headers={["REFERENCE", "DATE", "AMOUNT", "METHOD", "STATUS"]}
        rows={payments.map((p: Row) => [
          p.payment_reference,
          date(p.payment_date),
          money(p.amount_rwf),
          title(p.payment_method),
          <Status status={p.status} />,
        ])}
        empty="No recorded payments for this farmer."
      />
      {allocations?.length > 0 && (
        <p className="table-note">
          Each allocation is based on this farmer's eligible contribution
          quantity in a sold batch, after applicable deductions.
        </p>
      )}
    </div>
  );
}

export default function App() {
  const [token, setToken] = useState<string | null>(() =>
    sessionStorage.getItem("mavunotrail_token"),
  );
  const [farmerToken, setFarmerToken] = useState<string | null>(() =>
    sessionStorage.getItem("mavunotrail_farmer_token"),
  );
  const [identity, setIdentity] = useState<Row | null>(null);
  const [mode, setMode] = useState<"staff" | "farmer" | "farmer-login">(
    "staff",
  );
  const [checking, setChecking] = useState(Boolean(token || farmerToken));
  const [authError, setAuthError] = useState("");
  const logout = useCallback(() => {
    sessionStorage.removeItem("mavunotrail_token");
    sessionStorage.removeItem("mavunotrail_farmer_token");
    setToken(null);
    setFarmerToken(null);
    setIdentity(null);
    setChecking(false);
    setMode("staff");
  }, []);
  useEffect(() => {
    if (!token && !farmerToken) return;
    let mounted = true;
    const t = (token || farmerToken) as string;
    const isFarmer = !!farmerToken;
    request<{ data: Row }>("/api/auth/me", t)
      .then((result) => {
        if (!mounted) return;
        const expectedRole = isFarmer ? "farmer" : ["manager", "staff"];
        const allowedRoles = Array.isArray(expectedRole)
          ? expectedRole
          : [expectedRole];
        if (!allowedRoles.includes(result.data.role))
          throw new Error(
            isFarmer
              ? "This portal is for farmer accounts."
              : "This workspace is for cooperative staff accounts.",
          );
        setIdentity(result.data);
        setChecking(false);
      })
      .catch((e) => {
        if (!mounted) return;
        logout();
        setAuthError(e instanceof Error ? e.message : "Please sign in again.");
      });
    return () => {
      mounted = false;
    };
  }, [token, farmerToken, logout]);
  if (mode === "farmer-login")
    return (
      <FarmerLogin
        onAuthenticated={(value, user) => {
          setFarmerToken(value);
          setIdentity(user);
          setAuthError("");
          setMode("farmer");
        }}
      />
    );
  if (mode === "farmer" && farmerToken)
    return (
      <FarmerApp token={farmerToken} identity={identity!} onLogout={logout} />
    );
  if (mode === "farmer")
    return (
      <FarmerLogin
        onAuthenticated={(value, user) => {
          setFarmerToken(value);
          setIdentity(user);
          setAuthError("");
          setMode("farmer");
        }}
      />
    );
  if (checking)
    return (
      <div className="auth-loading">
        <span className="spinner" /> Checking your cooperative session…
      </div>
    );
  if (token && identity)
    return <StaffApp token={token} identity={identity} onLogout={logout} />;
  return (
    <ThirdwebProvider>
      <WalletLogin
        onAuthenticated={(value, user) => {
          setToken(value);
          setIdentity(user);
          setAuthError("");
        }}
        onDemo={() => setMode("farmer-login")}
      />
      {authError && <div className="auth-error">{authError}</div>}
    </ThirdwebProvider>
  );
}
