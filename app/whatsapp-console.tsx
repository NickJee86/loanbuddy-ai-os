"use client";
import { useMemo, useState } from "react";
import { buildConversationTimeline } from "./customer-360.mjs";
type Row = Record<string, string>;
type Lead = { id: string; name: string; phone: string; branch: string; owner: string };

export default function WhatsAppConsole({ leads, data, user, onChanged }: { leads: Lead[]; data: Record<string, Row[]>; user?: { role: string }; onChanged: () => void }) {
  const [leadId, setLeadId] = useState(leads[0]?.id || ""); const [message, setMessage] = useState(""); const [busy, setBusy] = useState(""); const [notice, setNotice] = useState("");
  const selected = leads.find((lead) => lead.id === leadId) || leads[0];
  const sources = useMemo(() => ({ customerInbox: data.Customer_Inbox || [], replyLog: data.Customer_Reply_Log || [], messageOutbox: data.Message_Outbox || [], documents: data.Document_Received_Log || [], activities: data.Lead_Activities || [], followUps: data.Follow_Up_Queue || [], creditDecisions: data.Credit_Decision_Log || [], verifications: data.Document_Verification_Log || [], assessments: data.Credit_Assessment || [], lmsQueue: data.LMS_Submission_Queue || [], lmsResults: data.LMS_Credit_Result || [] }), [data]);
  const timeline = selected ? buildConversationTimeline(selected.id, sources) : [];
  const state = (data.Conversation_State || []).find((row) => row["Lead ID"] === selected?.id) || {};
  const paused = state["AI Status"] === "PAUSED_MANUAL"; const canSend = user?.role !== "readonly";

  async function action(operation: "send" | "takeover" | "resume_ai") {
    if (!selected || busy) return; setBusy(operation); setNotice("");
    try {
      const response = await fetch("/api/whatsapp", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ operation, leadId: selected.id, leadName: selected.name, phone: selected.phone, branchId: selected.branch, salesId: selected.owner, message, idempotencyKey: crypto.randomUUID() }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || "Operation failed."); if (operation === "send") setMessage("");
      setNotice(operation === "send" ? "Message queued for WhatsApp delivery." : operation === "takeover" ? "AI paused. You now control this conversation." : "AI conversation resumed."); onChanged();
    } catch (error) { setNotice(error instanceof Error ? error.message : "Operation failed."); } finally { setBusy(""); }
  }

  if (!selected) return <section className="panel whatsapp-empty"><h2>No customer conversations</h2><p>Customer messages will appear here after the WhatsApp webhook records them.</p></section>;
  return <div className="whatsapp-console">
    <aside className="whatsapp-customers panel"><div className="section-heading"><div><h2>WhatsApp</h2><p>{leads.length} visible customers</p></div></div><div className="whatsapp-customer-list">{leads.map((lead) => <button key={lead.id} className={lead.id === selected.id ? "active" : ""} onClick={() => setLeadId(lead.id)}><strong>{lead.name || lead.id}</strong><span>{lead.phone}</span></button>)}</div></aside>
    <section className="panel whatsapp-thread"><header className="whatsapp-thread-head"><div><h2>{selected.name || selected.id}</h2><p>{selected.phone} · {selected.id}</p></div><button className={paused ? "secondary-button" : "danger-button"} disabled={!canSend || Boolean(busy)} onClick={() => action(paused ? "resume_ai" : "takeover")}>{busy === "takeover" || busy === "resume_ai" ? "Updating…" : paused ? "Resume AI" : "Take over from AI"}</button></header>
      <div className="ai-mode-banner"><strong>{paused ? "Manual mode" : "AI active"}</strong><span>{paused ? "AI replies are paused for this customer." : "Pause AI before handling the conversation manually."}</span></div>
      <div className="whatsapp-timeline">{timeline.length ? timeline.map((event: any) => <article key={event.id} className={`whatsapp-event ${event.direction || "system"}`}><span>{event.type === "document" ? `Document: ${event.fileName || event.documentType}` : event.text}</span><small>{[event.source, event.status, event.at].filter(Boolean).join(" · ")}</small></article>) : <div className="whatsapp-no-messages">No recorded messages for this customer yet.</div>}</div>
      <div className="whatsapp-composer"><textarea aria-label="WhatsApp message" value={message} maxLength={3000} placeholder={paused ? "Type a WhatsApp message…" : "Take over from AI before sending manually…"} disabled={!canSend || !paused || Boolean(busy)} onChange={(event) => setMessage(event.target.value)} /><div><span>{message.length}/3000</span><button disabled={!canSend || !paused || !message.trim() || Boolean(busy)} onClick={() => action("send")}>{busy === "send" ? "Queuing…" : "Send WhatsApp"}</button></div>{notice && <p className="whatsapp-notice">{notice}</p>}</div>
    </section>
  </div>;
}
