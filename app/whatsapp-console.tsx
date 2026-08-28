"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { buildConversationTimeline } from "./customer-360.mjs";

function normalizedIdentity(input: unknown) {
  const raw = String(input || "").trim();
  const digits = raw.replace(/\D/g, "");
  return digits.length >= 8 ? digits : raw.toLowerCase();
}

function conversationStateFor(selected: Lead | undefined, rows: Row[]) {
  if (!selected) return {};
  const selectedIds = new Set([selected.id, selected.phone].map(normalizedIdentity).filter(Boolean));
  return rows.find((row) =>
    ["Lead ID", "Phone Number", "WhatsApp Number", "Customer Phone", "Phone", "From"]
      .map((key) => normalizedIdentity(row[key]))
      .some((identity) => identity && selectedIds.has(identity))
  ) || {};
}
type Row = Record<string, string>;
type Lead = { id: string; name: string; phone: string; branch: string; owner: string };

export default function WhatsAppConsole({ leads, data, user, onChanged }: { leads: Lead[]; data: Record<string, Row[]>; user?: { role: string }; onChanged: () => void }) {
  const [leadId, setLeadId] = useState(leads[0]?.id || ""); const [message, setMessage] = useState(""); const [attachment, setAttachment] = useState<File | null>(null); const [previewUrl, setPreviewUrl] = useState(""); const [busy, setBusy] = useState(""); const [notice, setNotice] = useState(""); const [manualOverride, setManualOverride] = useState<boolean | null>(null); const fileInput = useRef<HTMLInputElement>(null); const previewRef = useRef("");
  const selected = leads.find((lead) => lead.id === leadId) || leads[0];
  const sources = useMemo(() => ({ customerInbox: data.Customer_Inbox || [], replyLog: data.Customer_Reply_Log || [], messageOutbox: data.Message_Outbox || [], documents: data.Document_Received_Log || [], activities: data.Lead_Activities || [], followUps: data.Follow_Up_Queue || [], creditDecisions: data.Credit_Decision_Log || [], verifications: data.Document_Verification_Log || [], assessments: data.Credit_Assessment || [], lmsQueue: data.LMS_Submission_Queue || [], lmsResults: data.LMS_Credit_Result || [] }), [data]);
  const timeline = selected ? buildConversationTimeline(selected.id, sources) : [];
  const state = conversationStateFor(selected, data.Conversation_State || []);
  const persistedPaused = state["AI Status"] === "PAUSED_MANUAL";
  const paused = manualOverride ?? persistedPaused; const canSend = user?.role !== "readonly";

  useEffect(() => { setManualOverride(null); }, [selected?.id]);
  useEffect(() => {
    if (manualOverride !== null && manualOverride === persistedPaused) setManualOverride(null);
  }, [manualOverride, persistedPaused]);

  useEffect(() => () => { if (previewRef.current) URL.revokeObjectURL(previewRef.current); }, []);

  function clearAttachment() {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = ""; setPreviewUrl(""); setAttachment(null); if (fileInput.current) fileInput.current.value = "";
  }

  function chooseAttachment(file?: File) {
    setNotice("");
    if (!file) { clearAttachment(); return; }
    const limit = file.type === "application/pdf" ? 10 * 1024 * 1024 : 5 * 1024 * 1024;
    if (!["image/jpeg", "image/png", "application/pdf"].includes(file.type)) { clearAttachment(); setNotice("Only JPG, PNG and PDF files are supported."); return; }
    if (file.size > limit) { clearAttachment(); setNotice(`File is too large (maximum ${limit / 1024 / 1024} MB).`); return; }
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    const nextPreview = file.type.startsWith("image/") ? URL.createObjectURL(file) : "";
    previewRef.current = nextPreview; setPreviewUrl(nextPreview); setAttachment(file);
  }

  async function action(operation: "send" | "takeover" | "resume_ai") {
    if (!selected || busy) return; setBusy(operation); setNotice("");
    try {
      let response: Response;
      if (operation === "send" && attachment) {
        const form = new FormData(); form.set("operation", "send_media"); form.set("leadId", selected.id); form.set("leadName", selected.name); form.set("phone", selected.phone); form.set("branchId", selected.branch); form.set("salesId", selected.owner); form.set("message", message); form.set("idempotencyKey", crypto.randomUUID()); form.set("file", attachment);
        response = await fetch("/api/whatsapp", { method: "POST", body: form });
      } else response = await fetch("/api/whatsapp", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ operation, leadId: selected.id, leadName: selected.name, phone: selected.phone, branchId: selected.branch, salesId: selected.owner, message, idempotencyKey: crypto.randomUUID() }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || "Operation failed.");
      if (operation === "send") { const sentMedia = Boolean(attachment); setMessage(""); clearAttachment(); setNotice(sentMedia ? "Media accepted by WhatsApp." : "Message queued for WhatsApp delivery."); }
      else {
        const nextPaused = operation === "takeover";
        setManualOverride(nextPaused);
        setNotice(nextPaused ? "AI paused. You now control this conversation." : "AI conversation resumed.");
      }
      await Promise.resolve(onChanged());
    } catch (error) { setNotice(error instanceof Error ? error.message : "Operation failed."); } finally { setBusy(""); }
  }

  if (!selected) return <section className="panel whatsapp-empty"><h2>No customer conversations</h2><p>Customer messages will appear here after the WhatsApp webhook records them.</p></section>;
  return <div className="whatsapp-console">
    <aside className="whatsapp-customers panel"><div className="section-heading"><div><h2>WhatsApp</h2><p>{leads.length} visible customers</p></div></div><div className="whatsapp-customer-list">{leads.map((lead) => <button key={lead.id} className={lead.id === selected.id ? "active" : ""} onClick={() => setLeadId(lead.id)}><strong>{lead.name || lead.id}</strong><span>{lead.phone}</span></button>)}</div></aside>
    <section className="panel whatsapp-thread"><header className="whatsapp-thread-head"><div><h2>{selected.name || selected.id}</h2><p>{selected.phone} · {selected.id}</p></div><button className={paused ? "secondary-button" : "danger-button"} disabled={!canSend || Boolean(busy)} onClick={() => action(paused ? "resume_ai" : "takeover")}>{busy === "takeover" || busy === "resume_ai" ? "Updating…" : paused ? "Resume AI" : "Take over from AI"}</button></header>
      <div className="ai-mode-banner"><strong>{paused ? "Manual mode" : "AI active"}</strong><span>{paused ? "AI replies are paused for this customer." : "Pause AI before handling the conversation manually."}</span></div>
      <div className="whatsapp-timeline">{timeline.length ? timeline.map((event: any) => <article key={event.id} className={`whatsapp-event ${event.direction || "system"}`}><span>{event.type === "document" ? `Document: ${event.fileName || event.documentType}` : event.text}</span>{event.attachmentFileName && <em>{event.attachmentType === "image" ? "Image" : "File"}: {event.attachmentFileName}</em>}<small>{[event.source, event.status, event.at].filter(Boolean).join(" · ")}</small></article>) : <div className="whatsapp-no-messages">No recorded messages for this customer yet.</div>}</div>
      <div className="whatsapp-composer"><textarea aria-label="WhatsApp message" value={message} maxLength={attachment ? 1024 : 3000} placeholder={paused ? attachment ? "Add an optional caption…" : "Type a WhatsApp message…" : "Take over from AI before sending manually…"} disabled={!canSend || !paused || Boolean(busy)} onChange={(event) => setMessage(event.target.value)} />{attachment && <div className="whatsapp-attachment-preview">{previewUrl ? <Image unoptimized width={50} height={50} src={previewUrl} alt="Selected upload preview" /> : <span className="whatsapp-file-icon">PDF</span>}<span><strong>{attachment.name}</strong><small>{(attachment.size / 1024 / 1024).toFixed(2)} MB</small></span><button type="button" aria-label="Remove attachment" disabled={Boolean(busy)} onClick={clearAttachment}>×</button></div>}<div><span>{message.length}/{attachment ? 1024 : 3000}</span><div className="whatsapp-send-actions"><input ref={fileInput} type="file" accept="image/jpeg,image/png,application/pdf" disabled={!canSend || !paused || Boolean(busy)} onChange={(event) => chooseAttachment(event.target.files?.[0])} /><button type="button" className="whatsapp-attach-button" disabled={!canSend || !paused || Boolean(busy)} onClick={() => fileInput.current?.click()}>Attach</button><button disabled={!canSend || !paused || (!message.trim() && !attachment) || Boolean(busy)} onClick={() => action("send")}>{busy === "send" ? attachment ? "Uploading…" : "Queuing…" : attachment ? "Send media" : "Send WhatsApp"}</button></div></div>{notice && <p className="whatsapp-notice">{notice}</p>}</div>
    </section>
  </div>;
}
