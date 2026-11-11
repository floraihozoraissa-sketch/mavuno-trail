import { useCallback, useEffect, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import "./App.css";
import { ThirdwebProvider } from "thirdweb/react";
import { createThirdwebClient } from "thirdweb";
import { BrowserProvider, Contract } from "ethers";
import heroImage from "./assets/hero.png";

const clientId = import.meta.env.VITE_THIRDWEB_CLIENT_ID;
const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";
if (clientId) createThirdwebClient({ clientId });
type Row = Record<string, any>;
type Section = "overview" | "farmers" | "deliveries" | "batches" | "sales" | "allocations" | "payments" | "audit";
const nav: { id: Section; label: string; icon: string }[] = [
  { id: "overview", label: "Overview", icon: "⌂" }, { id: "farmers", label: "Farmers", icon: "♧" },
  { id: "deliveries", label: "Deliveries", icon: "⇣" }, { id: "batches", label: "Batches", icon: "▦" },
  { id: "sales", label: "Buyer sales", icon: "↗" }, { id: "allocations", label: "Allocations", icon: "◷" },
  { id: "payments", label: "Payments", icon: "₣" }, { id: "audit", label: "Audit history", icon: "⌁" }
];
const money = (value: unknown) => `FRW ${Number(value || 0).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
const kg = (value: unknown) => `${Number(value || 0).toLocaleString("en-US", { maximumFractionDigits: 1 })} kg`;
const date = (value: unknown) => value ? new Date(String(value)).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—";
const title = (value: unknown) => String(value || "—").replaceAll("_", " ").replace(/\b\w/g, letter => letter.toUpperCase());

async function request<T = Row>(path: string, token: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...init?.headers }
  });
  const result = await response.json().catch(() => ({}));
  if (response.status === 401) {
    sessionStorage.removeItem("mavunotrail_token");
    window.dispatchEvent(new Event("mavuno-session-expired"));
  }
  if (!response.ok || result.success === false) throw new Error(result.message || `Request failed (${response.status})`);
  return result as T;
}

function Brand({ large = false }: { large?: boolean }) { return <div className={`brand ${large ? "brand-large" : ""}`}><span className="brand-mark">m</span><span>Mavuno<span className="brand-light">Trail</span><small>HARVEST, ACCOUNTED FOR</small></span></div>; }

// Wallet login for cooperative staff
function WalletLogin({ onAuthenticated, onDemo }: { onAuthenticated: (token: string, identity: Row) => void; onDemo: () => void }) {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  async function login() {
    const ethereum = (window as Window & { ethereum?: any }).ethereum;
    if (!ethereum) return setMessage("MetaMask not detected. Install MetaMask to sign in.");
    setLoading(true);
    try {
      setMessage("Requesting a secure sign-in nonce…");
      await ethereum.request({ method: "eth_requestAccounts" });
      const provider = new BrowserProvider(ethereum);
      const signer = await provider.getSigner();
      const address = await signer.getAddress();

      const { SiweMessage } = await import("siwe");
      const nr = await fetch(`${API_URL}/api/auth/nonce`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ walletAddress: address }) });
      const nonceResult = await nr.json();
      if (!nr.ok || !nonceResult.success) throw new Error(nonceResult.message || "Could not obtain login nonce.");
      const nonceData = nonceResult.data ?? nonceResult;
      const siwe = new SiweMessage({ domain: window.location.host, address, statement: "Sign in to MavunoTrail.", uri: window.location.origin, version: "1", chainId: 11155111, nonce: nonceData.nonce, issuedAt: new Date().toISOString(), expirationTime: new Date(Date.now() + 300000).toISOString() });
      setMessage("Approve the sign-in request in MetaMask…");
      const signature = await signer.signMessage(siwe.prepareMessage());
      const vr = await fetch(`${API_URL}/api/auth/verify`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: siwe.prepareMessage(), signature }) });
      const verified = await vr.json();
      if (!vr.ok || !verified.success) throw new Error(verified.message || "Wallet verification failed.");
      const auth = verified.data ?? verified;
      if (!auth.token) throw new Error("The server did not return an authentication token.");
      sessionStorage.setItem("mavunotrail_token", auth.token);
      const identity = await request<{ data: Row }>("/api/auth/me", auth.token);
      if (!["manager", "staff"].includes(identity.data.role)) throw new Error("This workspace is for cooperative staff accounts.");
      onAuthenticated(auth.token, identity.data);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Sign-in failed. Please try again."); }
    finally { setLoading(false); }
  }

  return <main className="login-page"><section className="login-card">
    <Brand large /><div className="eyebrow">COOPERATIVE PORTAL</div><h1>Good work starts with a clear record.</h1>
    <p className="muted login-copy">Follow every delivery from the collection point to the farmer's payment record.</p>
    <div className="wallet-box">
      <button className="button primary full" onClick={login} disabled={loading}>{loading ? "Signing in…" : "Sign in with MetaMask"}</button>
    </div>
    {message && <p className="notice" role="status">{message}</p>}
    <div className="separator"><span>OR EXPLORE</span></div>
    <button className="button secondary full" onClick={onDemo}>Open demo farmer view <span>→</span></button>
    <p className="fine-print">Demo farmer records are fictional. Staff access uses wallet verification and a cooperative account.</p>
  </section><div className="login-art"><img src={heroImage} alt="Potato harvest" /><div className="art-caption"><span>RWANDA · COOPERATIVE TRACEABILITY</span><strong>Every harvest<br />has a story.</strong></div></div></main>;
}

// Farmer login screen for demo mode
function FarmerLogin({ onAuthenticated }: { onAuthenticated: (token: string, identity: Row) => void }) {
  const [farmerCode, setFarmerCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  async function login() {
    if (!farmerCode.trim()) return setMessage("Enter a farmer code to continue.");
    setLoading(true); setMessage("");
    try {
      const response = await fetch(`${API_URL}/api/auth/farmer/demo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ farmerCode: farmerCode.trim().toUpperCase() })
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.message || "Demo access failed.");
      sessionStorage.setItem("mavunotrail_farmer_token", result.data.token);
      onAuthenticated(result.data.token, result.data.user);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not access demo farmer records."); }
    finally { setLoading(false); }
  }

  return <main className="login-page"><section className="login-card">
    <Brand large /><div className="eyebrow">FARMER PORTAL</div><h1>Follow your harvest story.</h1>
    <p className="muted login-copy">Enter your farmer code to see your deliveries, allocations, and payments.</p>
    <div className="wallet-box">
      <label className="span-2" style={{textAlign: "left"}}><span className="field-label">Farmer code</span><input value={farmerCode} onChange={e => setFarmerCode(e.target.value.toUpperCase())} placeholder="e.g. F-0248" style={{textTransform: "uppercase"}} /></label>
      <button className="button primary full" onClick={login} disabled={loading}>{loading ? "Loading…" : "View my harvest"}</button>
    </div>
    {message && <p className="notice" role="status">{message}</p>}
    <div className="demo-codes">
      <strong>Demo farmer codes:</strong>
      <div className="code-chips">{"F-0248 F-0312 F-0156 F-0421".split(" ").map(c => <span key={c} className="code-chip" onClick={() => setFarmerCode(c)}>{c}</span>)}</div>
      <p className="fine-print">These are fictional demonstration records. No real farmer data is exposed.</p>
    </div>
    <div className="separator"><span>OR RETURN</span></div>
    <button className="button secondary full" onClick={() => window.location.reload()}>Back to cooperative portal</button>
  </section><div className="login-art"><img src={heroImage} alt="Potato harvest" /><div className="art-caption"><span>RWANDA · COOPERATIVE TRACEABILITY</span><strong>Every harvest<br />has a story.</strong></div></div></main>;
}

// Main farmer application with real backend data
function FarmerApp({ token, identity, onLogout }: { token: string; identity: Row; onLogout: () => void }) {
  const [active, setActive] = useState<"home" | "journey" | "payments" | "deliveries">("home");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [statement, setStatement] = useState<Row | null>(null);
  const [deliveries, setDeliveries] = useState<Row[]>([]);
  const [auditEvents, setAuditEvents] = useState<Row[]>([]);

  useEffect(() => {
    let mounted = true;
    async function load() {
      setBusy(true); setError("");
      try {
        const [stmt, del, audits] = await Promise.all([
          request<{ data: Row }>(`/api/statements/farmer/${identity.id}`, token),
          request<{ data: Row[] }>(`/api/deliveries?farmerId=${identity.id}`, token),
          request<{ data: Row[] }>(`/api/audit-blockchain/events`, token)
        ]);
        if (!mounted) return;
        setStatement(stmt.data);
        setDeliveries(del.data);
        const deliveryIds = new Set(del.data.map((d: Row) => d.id));
        const farmerAudits = (audits.data || []).filter((a: Row) =>
          a.entity_type === "delivery" && deliveryIds.has(a.entity_id)
        );
        setAuditEvents(farmerAudits);
      } catch (e) { setError(e instanceof Error ? e.message : "Could not load your harvest records."); }
      finally { if (mounted) setBusy(false); }
    }
    load();
    return () => { mounted = false; };
  }, [token, identity.id]);

  if (busy) return <div className="farmer-shell"><header className="farmer-top"><Brand /><span className="demo-chip">DEMO FARMER MODE</span><button className="text-button" onClick={onLogout}>Exit demo</button></header><div className="auth-loading"><span className="spinner" /> Loading your harvest records…</div></div>;

  const summary = statement?.summary || { totalAllocatedRwf: 0, totalPaidRwf: 0, outstandingRwf: 0 };
  const allocations = statement?.allocations || [];
  const payments = statement?.payments || [];
  const farmer = statement?.farmer || identity;

  const getDeliveryJourney = (delivery: Row) => {
    const batchAudits = auditEvents.filter((a: Row) => a.entity_type === "batch" && a.new_values?.deliveries?.some((d: any) => d.delivery_id === delivery.id));
    const saleAudits = auditEvents.filter((a: Row) => a.entity_type === "sale");
    const hasBatch = batchAudits.length > 0 || delivery.batch_deliveries?.length > 0;
    const hasSale = saleAudits.length > 0;
    const hasAllocation = allocations.some((a: Row) => a.sale_batch_item_id && delivery.batch_deliveries?.some((bd: any) => bd.batch_id));
    const hasPayment = payments.length > 0;
    return { hasBatch, hasSale, hasAllocation, hasPayment };
  };

  const primaryDelivery = deliveries[0];
  const primaryJourney = primaryDelivery ? getDeliveryJourney(primaryDelivery) : { hasBatch: false, hasSale: false, hasAllocation: false, hasPayment: false };

  const journeyStatuses = [
    { label: "Delivered", detail: primaryDelivery ? `${date(primaryDelivery.delivered_at)} · ${kg(primaryDelivery.quantity_kg)}` : "—", complete: true },
    { label: "In a batch", detail: primaryJourney.hasBatch ? `Batch ${primaryDelivery?.batch_deliveries?.[0]?.batch_id?.slice(0,8) || "created"}` : "Awaiting batch assignment", complete: primaryJourney.hasBatch },
    { label: "Sold", detail: primaryJourney.hasSale ? "Buyer sale recorded" : "Batch not yet sold", complete: primaryJourney.hasSale },
    { label: "Allocated", detail: primaryJourney.hasAllocation ? `${money(summary.totalAllocatedRwf)} allocated` : "Awaiting sale", complete: primaryJourney.hasAllocation },
    { label: "Payment recorded", detail: primaryJourney.hasPayment ? `${money(summary.totalPaidRwf)} paid` : "Awaiting payment", complete: primaryJourney.hasPayment },
  ];

  return <div className="farmer-shell">
    <header className="farmer-top"><Brand /><span className="demo-chip">DEMO FARMER MODE</span><button className="text-button" onClick={onLogout}>Exit demo</button></header>
    <main className="farmer-content">
      <div className="farmer-greeting">
        <div className="eyebrow">YOUR HARVEST, YOUR STORY</div>
        <h1>Muraho, {farmer.full_name?.split(" ")[0] || "Farmer"} <span>👋</span></h1>
        <p>{farmer.farmer_code} <i>·</i> {[farmer.village, farmer.district].filter(Boolean).join(", ")}</p>
      </div>
      <div className="demo-banner"><span>ⓘ</span><div><strong>Fictional demo account</strong><p>This example uses sample records only. It is not connected to a real farmer account or real payments.</p></div></div>

      {error && <div className="alert error-alert" role="alert"><span>!</span>{error}<button onClick={() => setError("")} aria-label="Dismiss">×</button></div>}

      {active === "home" && <>
        <section className="earnings-card">
          <span className="light-label">TOTAL RECORDED EARNINGS</span>
          <strong>{money(summary.totalAllocatedRwf)}</strong>
          <div className="earned-meta">
            <span><i className="paid-dot" /> {money(summary.totalPaidRwf)} paid</span>
            <span>{money(summary.outstandingRwf)} balance</span>
          </div>
          <div className="progress"><span style={{ width: summary.totalAllocatedRwf > 0 ? `${Math.round(summary.totalPaidRwf / summary.totalAllocatedRwf * 100)}%` : "0%" }} /></div>
          <small>{summary.totalAllocatedRwf > 0 ? `${Math.round(summary.totalPaidRwf / summary.totalAllocatedRwf * 100)}%` : "0%"} of your allocation recorded as paid</small>
        </section>

        <section className="journey-card">
          <div className="section-heading"><div><span className="eyebrow">HARVEST JOURNEY</span><h2>From your farm to the market</h2></div><span className="journey-status">{journeyStatuses.filter(s => s.complete).length} of {journeyStatuses.length} steps complete</span></div>
          <div className="journey-line">
            {journeyStatuses.map((step, i) => <div className={`journey-step ${step.complete ? "complete" : ""}`} key={step.label}><span className="journey-node">{step.complete ? "✓" : i + 1}</span><div><strong>{step.label}</strong><small>{step.detail}</small></div></div>)}
          </div>
          <button className="button outline full" onClick={() => setActive("journey")}>Follow delivery details <span>→</span></button>
        </section>

        <section className="farmer-mini-grid">
          <button onClick={() => setActive("payments")}><span>◷</span><strong>Payment summary</strong><small>{money(summary.outstandingRwf)} outstanding</small></button>
          <button onClick={() => setActive("deliveries")}><span>▤</span><strong>Delivery history</strong><small>{deliveries.length} recorded</small></button>
        </section>
        <div className="sim-note">Payment records shown here are simulated examples. No money has been transferred.</div>
      </>}

      {active === "journey" && <section className="journey-card demo-detail">
        <button className="text-button" onClick={() => setActive("home")}>← Back to home</button>
        {primaryDelivery ? <>
          <span className="eyebrow">DELIVERY RECEIPT · {primaryDelivery.delivery_reference}</span>
          <h2>Potato delivery</h2>
          <div className="detail-grid">
            <span>Delivered<strong>{date(primaryDelivery.delivered_at)}</strong></span>
            <span>Quantity<strong>{kg(primaryDelivery.quantity_kg)}</strong></span>
            <span>Grade<strong>Grade {primaryDelivery.grade}</strong></span>
            <span>Collection centre<strong>{primaryDelivery.collection_centre?.name || "Selected centre"}</strong></span>
            <span>Batch<strong>{primaryDelivery.batch_deliveries?.[0]?.batch_id?.slice(0,8) || "Not yet assigned"}</strong></span>
            <span>Status<strong>{title(primaryDelivery.status)}</strong></span>
          </div>
          <div className="journey-line compact">
            {journeyStatuses.map((step, i) => <div className={`journey-step ${step.complete ? "complete" : ""}`} key={step.label}><span className="journey-node">{step.complete ? "✓" : i + 1}</span><div><strong>{step.label}</strong><small>{step.detail}</small></div></div>)}
          </div>
          {auditEvents.length > 0 && <div className="audit-section"><span className="eyebrow">BLOCKCHAIN VERIFICATION</span><p className="table-note">These events have been anchored to Ethereum Sepolia for tamper-evident proof.</p><div className="audit-list">{auditEvents.slice(0,3).map((a: Row) => <div key={a.id} className="audit-item"><span className="audit-event">{title(a.event_type)}</span><span className="audit-date">{date(a.recorded_at)}</span>{a.audit_event_anchors?.[0] && <a className="hash-link" href={`https://sepolia.etherscan.io/tx/${a.audit_event_anchors[0].transaction_hash}`} target="_blank" rel="noreferrer">View on Etherscan ↗</a>}</div>)}</div></div>}
        </> : <p className="empty-state">No deliveries recorded yet.</p>}
      </section>}

      {active === "payments" && <section className="journey-card demo-detail">
        <button className="text-button" onClick={() => setActive("home")}>← Back to home</button>
        <span className="eyebrow">PAYMENT SUMMARY</span>
        <h2>Your allocation</h2>
        {allocations.length > 0 && <div className="allocation-breakdown">
          {allocations.map((a: Row) => <div key={a.id} className="alloc-item"><div className="alloc-header"><span>{a.sale_batch_item_id?.slice(0,8)}</span><strong>{money(a.net_amount_rwf)}</strong></div><div className="alloc-details"><span>Eligible: {kg(a.eligible_quantity_kg)}</span><span>Share: {(Number(a.contribution_share) * 100).toFixed(1)}%</span><span>Deductions: {money(a.deductions_rwf)}</span></div></div>)}
        </div>}
        <div className="demo-payment-row"><span>Recorded allocation</span><strong>{money(summary.totalAllocatedRwf)}</strong></div>
        <div className="demo-payment-row"><span>Payments recorded</span><strong className="green-text">{money(summary.totalPaidRwf)}</strong></div>
        <div className="demo-payment-row"><span>Balance remaining</span><strong>{money(summary.outstandingRwf)}</strong></div>
        {payments.length > 0 && <div className="payment-history"><h3>Payment records <small>SIMULATED</small></h3>{payments.map((p: Row) => <div key={p.id} className="payment-item"><span>{date(p.payment_date)} · {title(p.payment_method)}</span><strong>{money(p.amount_rwf)}</strong></div>)}</div>}
        <p className="sim-note">A cooperative records a simulated payment entry here. This is not a mobile-money transfer.</p>
      </section>}

      {active === "deliveries" && <section className="journey-card demo-detail">
        <button className="text-button" onClick={() => setActive("home")}>← Back to home</button>
        <span className="eyebrow">DELIVERY HISTORY</span>
        <h2>{deliveries.length} recorded deliveries</h2>
        {deliveries.length > 0 ? <div className="deliveries-list">{deliveries.map((d: Row) => <div key={d.id} className="delivery-item"><div className="delivery-main"><strong>{d.delivery_reference}</strong><span>{date(d.delivered_at)} · {kg(d.quantity_kg)} · Grade {d.grade}</span></div><div className="delivery-meta"><span>{d.collection_centre?.name || "Centre"}</span><span className={`status ${["recorded", "approved"].includes(d.status) ? "status-good" : "status-neutral"}`}><i />{title(d.status)}</span></div></div>)}</div> : <p className="empty-state">No deliveries recorded yet.</p>}
      </section>}

    </main>
    <nav className="farmer-bottom">
      <button className={active === "home" ? "selected" : ""} onClick={() => setActive("home")}><span>⌂</span>Home</button>
      <button className={active === "journey" ? "selected" : ""} onClick={() => setActive("journey")}><span>⌁</span>My harvest</button>
      <button className={active === "payments" ? "selected" : ""} onClick={() => setActive("payments")}><span>◷</span>Payments</button>
      <button className={active === "deliveries" ? "selected" : ""} onClick={() => setActive("deliveries")}><span>▤</span>Deliveries</button>
    </nav>
  </div>;
}

// Staff application
function StaffApp({ token, identity, onLogout }: { token: string; identity: Row; onLogout: () => void }) {
  const [section, setSection] = useState<Section>("overview");
  const [data, setData] = useState<Record<string, any>>({});
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [receipt, setReceipt] = useState<Row | null>(null);
  const [farmerRecord, setFarmerRecord] = useState<Row | null>(null);
  const [batchRecord, setBatchRecord] = useState<Row | null>(null);
  const [showDeliveryForm, setShowDeliveryForm] = useState(false);
  const [showSaleForm, setShowSaleForm] = useState(false);
  const [showBatchForm, setShowBatchForm] = useState(false);
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [batchGrade, setBatchGrade] = useState("A");
  const [searchTerm, setSearchTerm] = useState("");
  const [saving, setSaving] = useState(false);
  const [anchoring, setAnchoring] = useState("");
  const load = useCallback(async () => {
    setBusy(true); setError("");
    try {
      const paths: Record<string, string> = { dashboard: "/api/dashboard", farmers: "/api/farmers", deliveries: "/api/deliveries", batches: "/api/batches", sales: "/api/sales", payments: "/api/payments", centres: "/api/reference/collection-centres", buyers: "/api/reference/buyers", audits: "/api/audit-blockchain/events" };
      const entries = await Promise.all(Object.entries(paths).map(async ([key, path]) => [key, await request<{ data: any }>(path, token).then(result => result.data)] as const));
      const next = Object.fromEntries(entries);
      next.sales = await Promise.all((next.sales as Row[]).map(async sale => {
        try { const detail = await request<{ data: Row }>(`/api/sales/${sale.id}`, token); return { ...sale, ...detail.data }; }
        catch { return sale; }
      }));
      const allocationSets = await Promise.all((next.farmers as Row[]).map(farmer => request<{ data: Row }>(`/api/statements/farmer/${farmer.id}`, token).then(result => result.data.allocations.map((allocation: Row) => ({ ...allocation, farmer_name: farmer.full_name, farmer_code: farmer.farmer_code, farmer_id: farmer.id }))).catch(() => [])));
      next.allocations = allocationSets.flat();
      setData(next);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load cooperative records."); }
    finally { setBusy(false); }
  }, [token]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const expired = () => onLogout(); window.addEventListener("mavuno-session-expired", expired); return () => window.removeEventListener("mavuno-session-expired", expired); }, [onLogout]);

  async function submit(event: FormEvent<HTMLFormElement>, path: string, payload: Row, after: () => void) {
    event.preventDefault(); setSaving(true); setError(""); setSuccess("");
    try { const result = await request<{ data: any; message?: string }>(path, token, { method: "POST", body: JSON.stringify(payload) }); setSuccess(result.message || "Record saved successfully."); after(); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not save this record."); }
    finally { setSaving(false); }
  }
  async function openFarmer(farmer: Row) {
    setBusy(true); setFarmerRecord(null);
    try { const [statement, deliveries] = await Promise.all([request<{ data: Row }>(`/api/statements/farmer/${farmer.id}`, token), request<{ data: Row[] }>(`/api/deliveries?farmerId=${farmer.id}`, token)]); setFarmerRecord({ ...statement.data, deliveries: deliveries.data }); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not load farmer record."); }
    finally { setBusy(false); }
  }
  async function openBatch(batch: Row) {
    setBusy(true); setBatchRecord(null);
    try { const result = await request<{ data: Row }>(`/api/batches/${batch.id}`, token); setBatchRecord(result.data); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not load batch details."); }
    finally { setBusy(false); }
  }
  async function anchorAuditEvent(auditEventId: string) {
    setError(""); setSuccess(""); setAnchoring(auditEventId);
    try {
      const ethereum = (window as Window & { ethereum?: any }).ethereum;
      if (!ethereum) throw new Error("MetaMask was not detected. Connect the authorized recorder wallet first.");
      const provider = new BrowserProvider(ethereum);
      await provider.send("eth_requestAccounts", []);
      const network = await provider.getNetwork();
      if (network.chainId !== 11155111n) throw new Error("Switch MetaMask to Ethereum Sepolia before anchoring.");
      const prepared = await request<{ data: Row }>(`/api/audit-blockchain/${auditEventId}/hash`, token);
      const proof = prepared.data;
      const contract = new Contract(proof.contractAddress, ["function anchorEvent(bytes32 eventHash, string eventType)"], await provider.getSigner());
      const tx = await contract.anchorEvent(proof.eventHash, proof.eventType);
      setSuccess("Transaction submitted. Waiting for Sepolia confirmation…");
      await tx.wait();
      const confirmation = await request<{ message: string }>(`/api/audit-blockchain/${auditEventId}/confirm`, token, { method: "POST", body: JSON.stringify({ transactionHash: tx.hash }) });
      setSuccess(confirmation.message || "Blockchain proof verified and saved.");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not anchor this audit event."); }
    finally { setAnchoring(""); }
  }
  const stats = data.dashboard || {};
  const activeBatches = (data.batches || []).filter((item: Row) => ["open", "active", "in_progress"].includes(item.status)).length;
  const allocationTotal = (data.allocations || []).filter((x: Row) => x.status === "approved").reduce((sum: number, x: Row) => sum + Number(x.net_amount_rwf), 0);
  const navTitle = nav.find(item => item.id === section)?.label || "Overview";

  return <div className="staff-app"><aside className="sidebar"><Brand /><div className="side-label">WORKSPACE</div><nav className="side-nav">{nav.map(item => <button key={item.id} onClick={() => { setSection(item.id); setFarmerRecord(null); setBatchRecord(null); setReceipt(null); }} className={section === item.id ? "active" : ""}><span className="nav-icon">{item.icon}</span>{item.label}{item.id === "deliveries" && <span className="nav-arrow">›</span>}</button>)}</nav><div className="side-bottom"><div className="co-op-mark">K</div><div className="co-op-name"><strong>Cooperative workspace</strong><small>Sepolia · Connected</small></div><button className="logout-icon" aria-label="Sign out" onClick={onLogout}>↪</button></div></aside>
    <div className="staff-main"><header className="topbar"><div className="crumb"><span>Workspace</span><b>/</b><strong>{navTitle}</strong></div><div className="top-actions"><span className="network-tag"><i /> SEPOLIA TESTNET</span><span className="avatar">{String(identity.walletAddress || "S").slice(2, 4).toUpperCase()}</span><span className="top-user">Cooperative staff<small>{String(identity.walletAddress || "").slice(0, 6)}…{String(identity.walletAddress || "").slice(-4)}</small></span></div></header>
      <main className="workspace"><div className="page-head"><div><div className="eyebrow">{new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).toUpperCase()} <span>·</span> RWANDA COOPERATIVE</div><h1>{section === "overview" ? "Good morning, team" : navTitle}</h1><p>{section === "overview" ? "Here's the story behind this season's harvest." : sectionCopy(section)}</p></div><div className="page-actions"><button className="button outline" onClick={() => void load()} disabled={busy}>↻ Refresh</button>{section === "deliveries" && <button className="button primary" onClick={() => { setReceipt(null); setShowDeliveryForm(true); }}>＋ Record delivery</button>}</div></div>
      {error && <div className="alert error-alert" role="alert"><span>!</span>{error}<button onClick={() => setError("")} aria-label="Dismiss">×</button></div>}{success && <div className="alert success-alert" role="status"><span>✓</span>{success}<button onClick={() => setSuccess("")} aria-label="Dismiss">×</button></div>}
      {busy && <div className="loading-line"><span className="spinner" /> Syncing cooperative records…</div>}
      {!busy && section === "overview" && <><div className="stats-grid">{[["Registered farmers", stats.totalFarmers, "Active member records", "♧", "forest"], ["Harvest received", kg(stats.totalDeliveredKg), `${Number(stats.totalDeliveries || 0).toLocaleString()} delivery records`, "⇣", "gold"], ["Active batches", activeBatches, `${stats.totalBatches || 0} batches in all`, "▦", "lavender"], ["Recorded sales", money(stats.totalSalesRwf), `${stats.totalSales || 0} buyer transactions`, "↗", "blue"]].map(([label, value, note, icon, color]) => <article className="stat-card" key={String(label)}><div className={`stat-icon ${color}`}>{icon}</div><span>{label}</span><strong>{value}</strong><small>{note}</small></article>)}</div>
        <div className="overview-grid"><section className="panel journey-panel"><div className="panel-head"><div><div className="eyebrow">HARVEST TO PAYMENT</div><h2>A clear path for every contribution</h2></div><button className="text-button" onClick={() => setSection("deliveries")}>View deliveries →</button></div><div className="process-flow">{[["01", "Delivery", "Weighed and receipted"], ["02", "Batch", "Grouped by grade"], ["03", "Sale", "Buyer proceeds recorded"], ["04", "Allocation", "Contribution share calculated"], ["05", "Payment", "Simulated payment tracked"]].map(([n, label, note], i) => <div className="flow-item" key={n}><div className={`flow-number flow-${i}`}>{n}</div><strong>{label}</strong><small>{note}</small>{i < 4 && <span className="flow-chevron">→</span>}</div>)}</div><div className="panel-footnote"><span>ⓘ</span> Each step links a cooperative record to the next. Blockchain anchors can provide tamper-evident evidence of recorded events.</div></section>
        <section className="panel allocation-panel"><div className="panel-head"><div><div className="eyebrow">FARMER ALLOCATIONS</div><h2>From sale to farmer share</h2></div><span className="soft-tag">APPROVED</span></div><div className="allocation-total">{money(stats.totalAllocatedRwf ?? allocationTotal)}<small>allocated to farmers</small></div><div className="allocation-rule"><div className="rule-icon">÷</div><p><strong>How shares are calculated</strong><span>Allocations follow each farmer's eligible quantity in a sold batch. Sale deductions are applied before net amounts are assigned.</span></p></div><button className="button outline full" onClick={() => setSection("allocations")}>Review allocations <span>→</span></button></section></div>
        <section className="panel recent-panel"><div className="panel-head"><div><div className="eyebrow">LATEST HARVEST RECORDS</div><h2>Recent deliveries</h2></div><button className="text-button" onClick={() => setSection("deliveries")}>All deliveries →</button></div><Table headers={["DELIVERY", "FARMER", "DATE", "QUANTITY", "GRADE", "STATUS"]} rows={(data.deliveries || []).slice(0, 5).map((d: Row) => [d.delivery_reference, farmerName(d.farmer_id, data.farmers), date(d.delivered_at), kg(d.quantity_kg), `Grade ${d.grade}`, <Status status={d.status} />])} empty="No deliveries yet. Record the first harvest to begin the journey." /></section>
        <div className="overview-bottom"><div className="amount-strip"><span>Payments recorded <strong>{money(stats.totalPaymentsRwf)}</strong></span><i /><span>Outstanding balance <strong>{money(stats.outstandingRwf)}</strong></span></div><span className="demo-payment-note">Payment entries are simulated records; no funds are transferred.</span></div>
      </>}
      {!busy && section === "farmers" && <section className="panel data-panel"><div className="panel-head"><div><div className="eyebrow">MEMBER DIRECTORY</div><h2>{data.farmers?.length || 0} registered farmers</h2></div><SearchBox placeholder="Search name or farmer code" value={searchTerm} onChange={setSearchTerm} /></div>{farmerRecord ? <FarmerDetail record={farmerRecord} onBack={() => setFarmerRecord(null)} /> : <Table headers={["FARMER", "FARMER CODE", "LOCATION", "PHONE", "STATUS", ""]} rows={(data.farmers || []).filter((f: Row) => `${f.full_name} ${f.farmer_code} ${f.village} ${f.district}`.toLowerCase().includes(searchTerm.toLowerCase())).map((f: Row) => [`<farmer>${f.full_name}`, f.farmer_code, [f.village, f.district].filter(Boolean).join(", ") || "—", f.phone || "—", <Status status={f.status} />, <button className="row-action" onClick={() => void openFarmer(f)}>View record →</button>])} empty="No farmers are registered yet." />}</section>}
      {!busy && section === "deliveries" && (receipt ? <DeliveryReceipt receipt={receipt} onBack={() => setReceipt(null)} onNew={() => { setReceipt(null); setShowDeliveryForm(true); }} /> : <section className="panel data-panel"><div className="panel-head"><div><div className="eyebrow">COLLECTION RECORDS</div><h2>{data.deliveries?.length || 0} recorded deliveries</h2></div><SearchBox placeholder="Search reference or farmer" value={searchTerm} onChange={setSearchTerm} /></div><Table headers={["DELIVERY REFERENCE", "FARMER", "DELIVERED", "QUANTITY", "GRADE", "STATUS"]} rows={(data.deliveries || []).filter((d: Row) => `${d.delivery_reference} ${farmerName(d.farmer_id, data.farmers)}`.toLowerCase().includes(searchTerm.toLowerCase())).map((d: Row) => [d.delivery_reference, farmerName(d.farmer_id, data.farmers), date(d.delivered_at), kg(d.quantity_kg), `Grade ${d.grade}`, <Status status={d.status} />])} empty="No deliveries yet. Use 'Record delivery' to create a receipt." /></section>)}
      {!busy && section === "batches" && (batchRecord ? <BatchDetail record={batchRecord} deliveries={data.deliveries || []} farmers={data.farmers || []} onBack={() => setBatchRecord(null)} /> : <section className="panel data-panel"><div className="panel-head"><div><div className="eyebrow">COLLECTION & GRADING</div><h2>{data.batches?.length || 0} batches</h2></div><button className="button primary" onClick={() => setShowBatchForm(true)}>＋ Create batch</button></div><Table headers={["BATCH", "GRADE", "DELIVERIES", "TOTAL QUANTITY", "CREATED", "STATUS", ""]} rows={(data.batches || []).map((b: Row) => [b.batchReference, `Grade ${b.grade}`, `${b.deliveryCount} deliveries`, kg(b.deliveredQuantityKg), date(b.createdAt), <Status status={b.status} />, <button className="row-action" onClick={() => void openBatch(b)}>View contents →</button>])} empty="No batches yet. Record a delivery, then create a batch from eligible deliveries." /> </section>)}
      {!busy && section === "sales" && <section className="panel data-panel"><div className="panel-head"><div><div className="eyebrow">BUYER TRANSACTIONS</div><h2>{data.sales?.length || 0} recorded sales</h2></div><button className="button primary" onClick={() => setShowSaleForm(true)}>＋ Record buyer sale</button></div><Table headers={["SALE REFERENCE", "BUYER", "BATCH", "QUANTITY SOLD", "GROSS", "DEDUCTIONS", "NET PROCEEDS", "STATUS"]} rows={(data.sales || []).map((s: Row) => { const item = s.items?.[0]; return [s.sale_reference, buyerName(s.buyer_id, data.buyers), (data.batches || []).find((b: Row) => b.id === item?.batch_id)?.batchReference || "—", kg(s.totalQuantityKg ?? item?.quantity_kg), money(s.gross_amount_rwf), money(s.deductions_rwf), money(s.net_amount_rwf), <Status status={s.status} />]; })} empty="No buyer sales recorded. Sell a batch to calculate farmer allocations." /></section>}
      {!busy && section === "allocations" && <section className="panel data-panel"><div className="panel-head"><div><div className="eyebrow">SALE PROCEEDS SHARED</div><h2>{money(allocationTotal)} total approved</h2></div><span className="basis-note">Eligible quantity ÷ sold batch quantity × net proceeds</span></div><Table headers={["FARMER", "ELIGIBLE QTY", "CONTRIBUTION SHARE", "GROSS SHARE", "DEDUCTIONS", "NET ALLOCATION", "STATUS"]} rows={(data.allocations || []).map((a: Row) => [<><strong>{a.farmer_name}</strong><small>{a.farmer_code}</small></>, kg(a.eligible_quantity_kg), `${(Number(a.contribution_share) * 100).toFixed(1)}%`, money(a.gross_amount_rwf), money(a.deductions_rwf), money(a.net_amount_rwf), <Status status={a.status} />])} empty="Allocations are generated when a sale is recorded against a batch." /><div className="table-note">Share = farmer's eligible batch quantity ÷ total quantity sold from the batch. Each share is applied to sale proceeds after deductions.</div></section>}
      {!busy && section === "payments" && <section className="panel data-panel"><div className="panel-head"><div><div className="eyebrow">SIMULATED PAYMENT RECORDS</div><h2>{data.payments?.length || 0} payment entries</h2></div><button className="button primary" onClick={() => setShowPaymentForm(true)}>＋ Record payment</button></div><div className="simulated-banner"><span>ⓘ</span> These entries document payment progress only. No money is transferred by MavunoTrail.</div><Table headers={["PAYMENT REFERENCE", "FARMER", "ALLOCATION", "AMOUNT", "METHOD", "DATE", "STATUS"]} rows={(data.payments || []).map((p: Row) => { const allocation = (data.allocations || []).find((a: Row) => a.id === p.allocation_id); return [p.payment_reference, allocation?.farmer_name || "Farmer record", String(p.allocation_id).slice(0, 8), money(p.amount_rwf), title(p.payment_method), date(p.payment_date), <Status status={p.status} />]; })} empty="No payment entries yet." /></section>}
      {!busy && section === "audit" && <section className="panel data-panel"><div className="panel-head"><div><div className="eyebrow">TAMPER-EVIDENT EVENT HISTORY</div><h2>{data.audits?.length || 0} audit events</h2></div><span className="network-tag"><i /> SEPOLIA</span></div><div className="simulated-banner"><span>ⓘ</span> A blockchain proof confirms that an event hash was anchored. It does not prove the original physical weight, sale, or payment was accurate.</div><Table headers={["EVENT", "RECORD TYPE", "RECORD ID", "RECORDED", "VERIFICATION", "TRANSACTION"]} rows={(data.audits || []).map((a: Row) => { const anchor = Array.isArray(a.audit_event_anchors) ? a.audit_event_anchors[0] : a.audit_event_anchors; return [title(a.event_type), title(a.entity_type), String(a.entity_id).slice(0, 10), date(a.recorded_at), anchor ? <Status status="verified on chain" /> : <Status status="not anchored" />, anchor?.transaction_hash ? <a className="hash-link" href={`https://sepolia.etherscan.io/tx/${anchor.transaction_hash}`} target="_blank" rel="noreferrer">{String(anchor.transaction_hash).slice(0, 10)}… ↗</a> : <button className="row-action" disabled={anchoring === a.id} onClick={() => void anchorAuditEvent(a.id)}>{anchoring === a.id ? "Anchoring…" : "Anchor with MetaMask"}</button>]; })} empty="Audit events will appear here when records are created." /></section>}
    </main></div>
    {showDeliveryForm && (
      <Modal title="Record a potato delivery" close={() => setShowDeliveryForm(false)}>
        <form onSubmit={e => {
          const form = new FormData(e.currentTarget);
          const farmer = (data.farmers || []).find((x: Row) => x.id === form.get("farmerId"));
          const quantityKg = Number(form.get("quantityKg"));
          const payload: Record<string, any> = {
            farmerId: form.get("farmerId"),
            collectionCentreId: form.get("collectionCentreId"),
            deliveryReference: form.get("deliveryReference"),
            deliveredAt: form.get("deliveredAt"),
            quantityKg,
            grade: form.get("grade"),
            notes: form.get("notes")
          };
          void submit(e, "/api/deliveries", payload, () => {
            const receiptObj: Row = {
              delivery_reference: payload.deliveryReference,
              delivered_at: payload.deliveredAt,
              quantity_kg: quantityKg,
              grade: payload.grade,
              farmer_name: farmer?.full_name,
              farmer_code: farmer?.farmer_code,
              collection_name: (data.centres || []).find((c: Row) => c.id === payload.collectionCentreId)?.name,
              status: "recorded"
            };
            setReceipt(receiptObj);
            setShowDeliveryForm(false);
          });
        }}>
          <div className="form-grid">
            <Field label="Farmer" name="farmerId" required>
              <option value="">Select a farmer</option>
              {(data.farmers || []).filter((f: Row) => f.status === "active").map((f: Row) => <option value={f.id} key={f.id}>{f.full_name} · {f.farmer_code}</option>)}
            </Field>
            <Field label="Collection centre" name="collectionCentreId" required>
              <option value="">Select collection centre</option>
              {(data.centres || []).map((c: Row) => <option value={c.id} key={c.id}>{c.name}</option>)}
            </Field>
            <label>Delivery reference<input name="deliveryReference" required placeholder="e.g. MT-D-2026-0142" /></label>
            <label>Date received<input type="date" name="deliveredAt" required defaultValue={new Date().toISOString().slice(0, 10)} /></label>
            <label>Quantity (kg)<input name="quantityKg" required type="number" min="0.1" step="0.1" placeholder="0.0" /></label>
            <Field label="Grade" name="grade" required>
              <option>A</option><option>B</option><option>C</option>
            </Field>
            <label className="span-2">Notes <span className="optional">OPTIONAL</span><textarea name="notes" rows={3} placeholder="Any observations..." /></label>
          </div>
          <ModalButtons loading={saving} onCancel={() => setShowDeliveryForm(false)} />
        </form>
      </Modal>
    )}
    {showBatchForm && <Modal title="Create a collection batch" close={() => setShowBatchForm(false)}><form onSubmit={e => { const form = new FormData(e.currentTarget); const ids = form.getAll("deliveryIds").map(String); const grade = String(form.get("grade")); const payload: Record<string, any> = { batchReference: form.get("batchReference"), grade, deliveries: ids.map(id => ({ deliveryId: id, quantityKg: Number((data.deliveries || []).find((d: Row) => d.id === id)?.availableQuantityKg ?? 0) })) }; void submit(e, "/api/batches", payload, () => setShowBatchForm(false)); }}><div className="form-grid"><label className="span-2">Batch reference<input name="batchReference" required placeholder="e.g. MT-B-2026-008" /></label><label>Grade<select name="grade" required value={batchGrade} onChange={e => setBatchGrade(e.target.value)}><option>A</option><option>B</option><option>C</option></select></label><div className="span-2"><span className="field-label">Unassigned deliveries · Grade {batchGrade}</span><div className="select-list">{(data.deliveries || []).filter((d: Row) => d.status === "recorded" && d.grade === batchGrade && Number(d.availableQuantityKg ?? 0) > 0).map((d: Row) => <label className="check-row" key={d.id}><input type="checkbox" name="deliveryIds" value={d.id} /><span>{d.delivery_reference} · {farmerName(d.farmer_id, data.farmers)}</span><small>{kg(d.availableQuantityKg)} available</small></label>)}</div><small className="helper">Selected deliveries will contribute their remaining unassigned quantity to this batch.</small></div></div><ModalButtons loading={saving} onCancel={() => setShowBatchForm(false)} /></form></Modal>}
    {showSaleForm && <Modal title="Record buyer sale" close={() => setShowSaleForm(false)}><form onSubmit={e => { const form = new FormData(e.currentTarget); const payload: Record<string, any> = { buyerId: form.get("buyerId"), saleReference: form.get("saleReference"), saleDate: form.get("saleDate"), batchId: form.get("batchId"), quantityKg: Number(form.get("quantityKg")), pricePerKgRwf: Number(form.get("pricePerKgRwf")), deductionsRwf: Number(form.get("deductionsRwf")) }; void submit(e, "/api/sales", payload, () => setShowSaleForm(false)); }}><div className="form-grid"><Field label="Buyer" name="buyerId" required><option value="">Select buyer</option>{(data.buyers || []).map((b: Row) => <option value={b.id} key={b.id}>{b.name}</option>)}</Field><Field label="Batch" name="batchId" required><option value="">Select batch</option>{(data.batches || []).filter((b: Row) => b.status !== "sold").map((b: Row) => <option value={b.id} key={b.id}>{b.batchReference} · Grade {b.grade} · {kg(b.deliveredQuantityKg)}</option>)}</Field><label>Sale reference<input name="saleReference" required placeholder="e.g. MT-S-2026-021" /></label><label>Sale date<input name="saleDate" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} /></label><label>Quantity sold (kg)<input name="quantityKg" type="number" step="0.1" min="0.1" required /></label><label>Price per kg (FRW)<input name="pricePerKgRwf" type="number" min="0" required /></label><label className="span-2">Deductions (FRW)<input name="deductionsRwf" type="number" min="0" defaultValue="0" required /></label></div><div className="form-info">The sale endpoint calculates each farmer's allocation using their eligible quantity in the batch.</div><ModalButtons loading={saving} onCancel={() => setShowSaleForm(false)} /></form></Modal>}
    {showPaymentForm && <Modal title="Record a simulated payment" close={() => setShowPaymentForm(false)}><form onSubmit={e => { const form = new FormData(e.currentTarget); const payload: Record<string, any> = { allocationId: form.get("allocationId"), amountRwf: Number(form.get("amountRwf")), paymentMethod: form.get("paymentMethod"), paymentDate: form.get("paymentDate") }; void submit(e, "/api/payments", payload, () => setShowPaymentForm(false)); }}><div className="simulated-banner"><span>ⓘ</span> Demonstration record only. No real money will be transferred.</div><div className="form-grid"><Field label="Approved farmer allocation" name="allocationId" required><option value="">Select farmer allocation</option>{(data.allocations || []).filter((a: Row) => a.status === "approved").map((a: Row) => <option value={a.id} key={a.id}>{a.farmer_name} · {money(a.net_amount_rwf)}</option>)}</Field><label>Amount (FRW)<input name="amountRwf" type="number" min="1" step="1" required /></label><Field label="Record method" name="paymentMethod" required><option value="mobile_money">Mobile money (simulated)</option><option value="bank_transfer">Bank transfer (simulated)</option><option value="cash">Cash record</option><option value="other">Other</option></Field><label>Date recorded<input name="paymentDate" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} /></label></div><ModalButtons loading={saving} onCancel={() => setShowPaymentForm(false)} /></form></Modal>}
  </div>;
}

function sectionCopy(section: Section) { return ({ farmers: "Member profiles and their recorded harvest and payment information.", deliveries: "Receive and weigh harvests, then give farmers a clear receipt.", batches: "Group compatible delivery quantities for buyer sale.", sales: "Record buyer proceeds and generate farmer allocation shares.", allocations: "See how eligible batch quantities translate into each farmer's share.", payments: "Track recorded payment progress. Entries are simulated; no funds are transferred.", audit: "Review business events and the verification status of their on-chain proof.", overview: "" } as Record<Section, string>)[section]; }
function farmerName(id: string, farmers: Row[] = []) { const found = farmers.find(f => f.id === id); return found?.full_name || "Farmer record"; }
function buyerName(id: string, buyers: Row[] = []) { return buyers.find(b => b.id === id)?.name || "Buyer"; }
function SearchBox({ placeholder, value, onChange }: { placeholder: string; value: string; onChange: (value: string) => void }) { return <div className="search-box"><span>⌕</span><input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} /></div>; }
function Status({ status }: { status: unknown }) { const value = String(status || "unknown"); const verified = value.includes("verified"); return <span className={`status ${verified ? "status-verified" : ["recorded", "approved", "active", "sold", "closed"].includes(value) ? "status-good" : "status-neutral"}`}><i />{title(value)}</span>; }
function Table({ headers, rows, empty }: { headers: string[]; rows: any[][]; empty: string; onRowClick?: undefined }) { return <div className="table-wrap">{rows.length ? <table><thead><tr>{headers.map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>{rows.map((row, i) => <tr key={i}>{row.map((item, j) => <td key={j}>{typeof item === "string" && item.startsWith("<farmer>") ? <strong>{item.slice(8)}</strong> : item}</td>)}</tr>)}</tbody></table> : <div className="empty-state"><span>▤</span><strong>Nothing recorded here yet</strong><p>{empty}</p></div>}</div>; }
function Modal({ title, children, close }: { title: string; children: ReactNode; close: () => void }) { return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) close(); }}><section className="modal"><header><div><span className="eyebrow">COOPERATIVE RECORD</span><h2>{title}</h2></div><button className="close-button" onClick={close} aria-label="Close">×</button></header>{children}</section></div>; }
function Field({ label, name, children, required }: { label: string; name: string; children: ReactNode; required?: boolean }) { return <label>{label}<select name={name} required={required}>{children}</select></label>; }
function ModalButtons({ loading, onCancel }: { loading: boolean; onCancel: () => void }) { return <div className="modal-actions"><button type="button" className="button outline" onClick={onCancel}>Cancel</button><button className="button primary" disabled={loading}>{loading ? "Saving…" : "Save record"}</button></div>; }
function DeliveryReceipt({ receipt, onBack, onNew }: { receipt: Row; onBack: () => void; onNew: () => void }) { return <section className="receipt-card"><div className="receipt-top"><div className="receipt-check">✓</div><span className="eyebrow">DELIVERY RECEIPT</span><h2>Harvest received</h2><p>The delivery record was saved to the cooperative ledger.</p></div><div className="receipt-reference"><span>DELIVERY REFERENCE</span><strong>{receipt.delivery_reference}</strong><Status status="recorded" /></div><div className="receipt-details"><span>Farmer<strong>{receipt.farmer_name}</strong><small>{receipt.farmer_code}</small></span><span>Received on<strong>{date(receipt.delivered_at)}</strong></span><span>Quantity<strong>{kg(receipt.quantity_kg)}</strong></span><span>Grade<strong>Grade {receipt.grade}</strong></span><span>Collection centre<strong>{receipt.collection_name || "Selected centre"}</strong></span></div><div className="receipt-next"><span className="next-icon">⌁</span><p><strong>What happens next?</strong><small>This delivery can join a batch with other Grade {receipt.grade} harvests. When the batch is sold, the sale will create a farmer allocation.</small></p></div><div className="receipt-actions"><button className="button outline" onClick={onBack}>Back to deliveries</button><button className="button primary" onClick={onNew}>Record another <span>→</span></button></div></section>; }
function BatchDetail({ record, deliveries, farmers, onBack }: { record: Row; deliveries: Row[]; farmers: Row[]; onBack: () => void }) { const assignments = record.batch_deliveries || []; return <section className="panel data-panel"><button className="text-button" onClick={onBack}>← Back to batches</button><div className="batch-summary"><div><span className="eyebrow">BATCH CONTENTS</span><h2>{record.batch_reference}</h2><p>Grade {record.grade} · {assignments.length} delivery contributions</p></div><Status status={record.status} /><strong>{kg(record.deliveredQuantityKg)}</strong></div><Table headers={["DELIVERY", "FARMER", "ASSIGNED QUANTITY", "DELIVERED", "DATE"]} rows={assignments.map((assignment: Row) => { const delivery = deliveries.find(d => d.id === assignment.delivery_id); return [delivery?.delivery_reference || String(assignment.delivery_id).slice(0, 10), delivery ? farmerName(delivery.farmer_id, farmers) : "Farmer record", kg(assignment.quantity_kg), kg(delivery?.quantity_kg), date(delivery?.delivered_at)]; })} empty="No deliveries are assigned to this batch yet." /><p className="table-note">A batch is made from recorded delivery quantities. The assigned amount can be less than the full delivery when only part of a farmer's harvest is grouped.</p></section>; }
function FarmerDetail({ record, onBack }: { record: Row; onBack: () => void }) { const { farmer, summary, allocations, payments, deliveries } = record; return <div className="farmer-record"><button className="text-button" onClick={onBack}>← Back to directory</button><div className="farmer-record-head"><div className="farmer-initial">{farmer.full_name.split(" ").map((x: string) => x[0]).slice(0, 2).join("")}</div><div><h2>{farmer.full_name}</h2><p>{farmer.farmer_code} · {[farmer.village, farmer.district].filter(Boolean).join(", ")}</p></div><Status status={farmer.status} /></div><div className="record-stats"><span>Deliveries<strong>{deliveries.length}</strong></span><span>Allocated<strong>{money(summary.totalAllocatedRwf)}</strong></span><span>Paid<strong>{money(summary.totalPaidRwf)}</strong></span><span>Balance<strong>{money(summary.outstandingRwf)}</strong></span></div><h3>Delivery history</h3><Table headers={["REFERENCE", "DATE", "QUANTITY", "GRADE", "STATUS"]} rows={deliveries.map((d: Row) => [d.delivery_reference, date(d.delivered_at), kg(d.quantity_kg), `Grade ${d.grade}`, <Status status={d.status} />])} empty="No deliveries for this farmer." /><h3>Payment records <small>SIMULATED</small></h3><Table headers={["REFERENCE", "DATE", "AMOUNT", "METHOD", "STATUS"]} rows={payments.map((p: Row) => [p.payment_reference, date(p.payment_date), money(p.amount_rwf), title(p.payment_method), <Status status={p.status} />])} empty="No recorded payments for this farmer." />{allocations?.length > 0 && <p className="table-note">Each allocation is based on this farmer's eligible contribution quantity in a sold batch, after applicable deductions.</p>}</div>; }

export default function App() {
  const [token, setToken] = useState<string | null>(() => sessionStorage.getItem("mavunotrail_token"));
  const [farmerToken, setFarmerToken] = useState<string | null>(() => sessionStorage.getItem("mavunotrail_farmer_token"));
  const [identity, setIdentity] = useState<Row | null>(null);
  const [mode, setMode] = useState<"staff" | "farmer" | "farmer-login">("staff");
  const [checking, setChecking] = useState(Boolean(token || farmerToken));
  const [authError, setAuthError] = useState("");
  const logout = useCallback(() => { sessionStorage.removeItem("mavunotrail_token"); sessionStorage.removeItem("mavunotrail_farmer_token"); setToken(null); setFarmerToken(null); setIdentity(null); setChecking(false); setMode("staff"); }, []);
  useEffect(() => { if (!token && !farmerToken) return; let mounted = true; const t = (token || farmerToken) as string; const isFarmer = !!farmerToken; request<{ data: Row }>("/api/auth/me", t).then(result => { if (!mounted) return; const expectedRole = isFarmer ? "farmer" : ["manager", "staff"]; const allowedRoles = Array.isArray(expectedRole) ? expectedRole : [expectedRole]; if (!allowedRoles.includes(result.data.role)) throw new Error(isFarmer ? "This portal is for farmer accounts." : "This workspace is for cooperative staff accounts."); setIdentity(result.data); setChecking(false); }).catch(e => { if (!mounted) return; logout(); setAuthError(e instanceof Error ? e.message : "Please sign in again."); }); return () => { mounted = false; }; }, [token, farmerToken, logout]);
  if (mode === "farmer-login") return <FarmerLogin onAuthenticated={(value, user) => { setFarmerToken(value); setIdentity(user); setAuthError(""); setMode("farmer"); }} />;
  if (mode === "farmer" && farmerToken) return <FarmerApp token={farmerToken} identity={identity!} onLogout={logout} />;
  if (mode === "farmer") return <FarmerLogin onAuthenticated={(value, user) => { setFarmerToken(value); setIdentity(user); setAuthError(""); setMode("farmer"); }} />;
  if (checking) return <div className="auth-loading"><span className="spinner" /> Checking your cooperative session…</div>;
  if (token && identity) return <StaffApp token={token} identity={identity} onLogout={logout} />;
  return <ThirdwebProvider><WalletLogin onAuthenticated={(value, user) => { setToken(value); setIdentity(user); setAuthError(""); }} onDemo={() => setMode("farmer-login")} />{authError && <div className="auth-error">{authError}</div>}</ThirdwebProvider>;
}