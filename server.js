// server.js (ESM)

import dns from "dns";
import express from "express";
import cors from "cors";
import crypto from "crypto";
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";

dns.setDefaultResultOrder("ipv4first");
const { promises: dnsPromises } = dns;

const app = express();

// CORS
app.use(
  cors({
    origin: "http://localhost:5173"
  })
);
app.use(express.json());

// Env vars
const SUPABASE_URL = (process.env.SUPABASE_URL || "").trim();
const SUPABASE_SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

// Resend env vars
const RESEND_API_KEY = (process.env.RESEND_API_KEY || "").trim();
const EMAIL_FROM = (process.env.EMAIL_FROM || "").trim(); // example: Beacon AI <support@shorelinedevco.com>
const INTERNAL_BCC_EMAIL = (process.env.INTERNAL_BCC_EMAIL || "").trim(); // example: support@shorelinedevco.com

// Public backend URL for tracked links (local: http://localhost:3001, prod: your Railway URL)
const PUBLIC_BACKEND_URL = (process.env.PUBLIC_BACKEND_URL || "http://localhost:3001").trim();

// Tables
const REPORTS_TABLE = "beacon_ai";
const LEADS_TABLE = "beacon_ai_leads";
const EVENTS_TABLE = "beacon_ai_events";

// Clients
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.warn("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Supabase calls will fail.");
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

//
// Helpers
//

function normalizeUrl(input) {
  let url = (input || "").trim();
  if (!url) return null;

  if (!/^https?:\/\//i.test(url)) url = "https://" + url;

  try {
    const u = new URL(url);
    let host = u.hostname.toLowerCase();
    if (host.startsWith("www.")) host = host.slice(4);
    return host;
  } catch {
    return null;
  }
}

function hashString(s) {
  return crypto.createHash("sha256").update(s).digest("hex");
}

function isValidEmailFormat(value) {
  const email = (value || "").trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function emailHasMx(value) {
  const email = (value || "").trim().toLowerCase();
  const domain = email.split("@")[1];
  if (!domain) return false;

  try {
    const mx = await dnsPromises.resolveMx(domain);
    return Array.isArray(mx) && mx.length > 0;
  } catch {
    return false;
  }
}

async function saveLead({
  email,
  businessName,
  name,
  domain,
  urlHash,
  score,
  summary,
  recommendation
}) {
  try {
    const { error } = await supabase.from(LEADS_TABLE).insert({
      email,
      business_name: (businessName || "").trim() || "Unknown Business",
      contact_name: (name || "").trim() || null,
      domain,
      url_hash: urlHash,
      score: score ?? null,
      summary: summary ?? null,

      recommended_tier: recommendation?.tier ?? null,
      recommended_package_name: recommendation?.packageName ?? null,
      recommended_price: recommendation?.price ?? null,
      recommended_discount_percent: recommendation?.discountPercent ?? null,
      recommended_discounted_price: recommendation?.discountedPrice ?? null,
      discount_code: recommendation?.code ?? null,
      discount_deadline_hours: 48
    });

    if (error) console.error("Lead save failed:", error.message);
  } catch (err) {
    console.error("Lead save exception:", err?.message || err);
  }
}

function safeString(v) {
  return String(v || "").trim();
}

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatUsd(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return "";
  return `$${n.toFixed(2)}`;
}

function calcDiscountedPrice(price, discountPercent) {
  const p = Number(price);
  const d = Number(discountPercent);
  if (!Number.isFinite(p) || !Number.isFinite(d)) return null;
  return Math.round(p * (1 - d / 100) * 100) / 100;
}

/**
 * Backend mapping for the locked packages and discount.
 * Thresholds can be adjusted to match your UI exactly.
 */
function recommendPackageFromReport(report) {
  const score = Number(report?.score);

  // Locked offer
  const discountPercent = 15;
  const code = "BEACON15";
  const urgencyLine = "Book within 48 hours to claim the discount.";

  // Choose tier by score
  let tier = "Business";
  if (Number.isFinite(score)) {
    if (score >= 85) tier = "Starter";
    else if (score >= 60) tier = "Business";
    else tier = "Premium";
  }

  const packages = {
    Starter: {
      name: "Starter Website",
      price: 299,
      bullets: [
        "Clean, modern single page layout",
        "Clear call to action and lead capture",
        "Mobile friendly layout and basic performance cleanup",
        "Perfect for simple service businesses"
      ]
    },
    Business: {
      name: "Business Website",
      price: 499,
      bullets: [
        "Multi section or small multi page structure",
        "Conversion focused layout with strong calls to action",
        "Basic SEO setup and on page improvements",
        "Ideal for most local businesses"
      ]
    },
    Premium: {
      name: "Premium Website",
      price: 899,
      bullets: [
        "Full custom build with multiple pages and strategy",
        "Stronger SEO foundation and content structure",
        "Performance and accessibility improvements",
        "Best for competitive niches and scaling"
      ]
    }
  };

  const selected = packages[tier];
  const discountedPrice = calcDiscountedPrice(selected.price, discountPercent);

  return {
    tier,
    packageName: selected.name,
    price: selected.price,
    discountPercent,
    discountedPrice,
    code,
    urgencyLine,
    bullets: selected.bullets
  };
}

function buildEmailText({ businessNameValue, websiteValue, report }) {
  const rec = recommendPackageFromReport(report);

  const lines = [];
  lines.push("Beacon AI Website Report");
  lines.push("");
  lines.push(`Business: ${businessNameValue || "Unknown Business"}`);
  lines.push(`Website: ${websiteValue || "Unknown Website"}`);
  if (report?.score !== undefined && report?.score !== null) lines.push(`Score: ${report.score}/100`);
  lines.push("");
  lines.push("Summary:");
  lines.push(report?.summary || "Not available");
  lines.push("");

  lines.push("Recommended Package:");
  lines.push(`${rec.packageName}`);
  lines.push(`Price: ${formatUsd(rec.price)}`);
  lines.push(`Discount: ${rec.discountPercent}% off`);
  lines.push(`Discounted Price: ${formatUsd(rec.discountedPrice)}`);
  lines.push(rec.urgencyLine);
  lines.push(`Discount Code: ${rec.code}`);
  lines.push("");

  if (Array.isArray(rec.bullets) && rec.bullets.length) {
    lines.push("Includes:");
    for (const b of rec.bullets) lines.push(`- ${b}`);
    lines.push("");
  }

  lines.push("If you want help improving your website, reply to this email.");
  lines.push("Shoreline Dev Co: https://shorelinedevco.com");
  return lines.join("\n");
}

function buildTrackedUrl({ to, eventType, report, rec }) {
  const base = PUBLIC_BACKEND_URL || "http://localhost:3001";
  const u = new URL("/r", base);

  u.searchParams.set("to", to);
  u.searchParams.set("e", eventType);
  u.searchParams.set("h", report?.url_hash || "");
  u.searchParams.set("d", report?.domain || "");
  u.searchParams.set("t", rec?.tier || "");

  return u.toString();
}

function buildEmailHtml({ businessNameValue, websiteValue, report }) {
  const business = escapeHtml(businessNameValue || "Your Business");
  const website = escapeHtml(websiteValue || "");

  const score = report?.score ?? null;
  const summary = escapeHtml(report?.summary || "Not available.");

  const title = escapeHtml(report?.title || "Not found");
  const meta = escapeHtml(report?.meta_description || "Not found");
  const h1 = escapeHtml(report?.h1_count ?? "Not found");

  const scoreLabel = score === null ? "N/A" : `${score}/100`;

  const scoreColor =
    score === null
      ? "#94a3b8"
      : score >= 90
        ? "#22c55e"
        : score >= 70
          ? "#3b82f6"
          : score >= 50
            ? "#eab308"
            : "#ef4444";

  const rec = recommendPackageFromReport(report);

  const recName = escapeHtml(rec.packageName);
  const recPrice = formatUsd(rec.price);
  const recDiscounted = formatUsd(rec.discountedPrice);
  const recCode = escapeHtml(rec.code);
  const recUrgency = escapeHtml(rec.urgencyLine);

  const recBulletsHtml =
    Array.isArray(rec.bullets) && rec.bullets.length
      ? `<ul style="margin:10px 0 0 18px;padding:0;color:rgba(229,231,235,0.92);font-size:13px;line-height:1.6;">
          ${rec.bullets.map((b) => `<li style="margin:6px 0;">${escapeHtml(b)}</li>`).join("")}
        </ul>`
      : "";

  // Tracked CTA link
  const bookCallUrl = buildTrackedUrl({
    to: "https://shorelinedevco.com/contact",
    eventType: "cta_book_call",
    report,
    rec
  });

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Beacon AI Report</title>
  </head>
  <body style="margin:0;padding:0;background:#0b1220;font-family:Arial,Helvetica,sans-serif;color:#e5e7eb;">
    <div style="max-width:680px;margin:0 auto;padding:24px;">
      <div style="background:#0f1b33;border:1px solid rgba(255,255,255,0.10);border-radius:16px;overflow:hidden;">
        <div style="padding:18px 20px;background:linear-gradient(180deg, rgba(92,200,255,0.20), rgba(43,123,255,0.10));border-bottom:1px solid rgba(255,255,255,0.10);">
          <div style="font-size:18px;font-weight:800;letter-spacing:0.2px;">Beacon AI Website Report</div>
          <div style="margin-top:6px;font-size:13px;color:rgba(229,231,235,0.80);">Shoreline Dev Co</div>
        </div>

        <div style="padding:18px 20px;">
          <div style="font-size:14px;color:rgba(229,231,235,0.85);">
            Here are the scan results for <strong>${business}</strong>.
          </div>

          <div style="margin-top:12px;padding:14px;border-radius:14px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.10);">
            <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center;justify-content:space-between;">
              <div>
                <div style="font-size:12px;color:rgba(229,231,235,0.70);">Website</div>
                <div style="margin-top:4px;font-size:14px;font-weight:700;">${website}</div>
              </div>

              <div style="text-align:right;">
                <div style="font-size:12px;color:rgba(229,231,235,0.70);">Score</div>
                <div style="margin-top:4px;font-size:16px;font-weight:900;color:${scoreColor};">${scoreLabel}</div>
              </div>
            </div>
          </div>

          <div style="margin-top:14px;">
            <div style="font-size:13px;color:rgba(229,231,235,0.70);">Summary</div>
            <div style="margin-top:6px;font-size:14px;line-height:1.6;color:rgba(229,231,235,0.92);">
              ${summary}
            </div>
          </div>

          <div style="margin-top:16px;padding:14px;border-radius:14px;background:rgba(92,200,255,0.08);border:1px solid rgba(92,200,255,0.22);">
            <div style="font-size:12px;color:rgba(229,231,235,0.70);">Recommended Package</div>
            <div style="margin-top:4px;font-size:16px;font-weight:900;color:#eaf6ff;">${recName}</div>

            <div style="margin-top:8px;font-size:13px;color:rgba(229,231,235,0.90);">
              <span style="color:rgba(229,231,235,0.70);text-decoration:line-through;">${recPrice}</span>
              <span style="margin-left:8px;font-weight:900;">${recDiscounted}</span>
              <span style="margin-left:8px;color:rgba(229,231,235,0.75);">(${rec.discountPercent}% off)</span>
            </div>

            <div style="margin-top:8px;font-size:12px;color:rgba(229,231,235,0.75);">${recUrgency}</div>

            <div style="margin-top:8px;font-size:12px;color:rgba(229,231,235,0.85);">
              Discount code:
              <span style="display:inline-block;margin-left:6px;padding:4px 8px;border-radius:10px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.14);font-weight:900;letter-spacing:0.6px;">
                ${recCode}
              </span>
            </div>

            ${recBulletsHtml}
          </div>

          <div style="margin-top:16px;padding-top:16px;border-top:1px solid rgba(255,255,255,0.10);">
            <div style="font-size:13px;font-weight:800;margin-bottom:10px;">Basic checks</div>

            <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:separate;border-spacing:0 10px;">
              <tr>
                <td style="padding:12px 14px;border-radius:12px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.10);">
                  <div style="font-size:12px;color:rgba(229,231,235,0.70);">Title</div>
                  <div style="margin-top:4px;font-size:14px;font-weight:700;">${title}</div>
                </td>
              </tr>
              <tr>
                <td style="padding:12px 14px;border-radius:12px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.10);">
                  <div style="font-size:12px;color:rgba(229,231,235,0.70);">Meta description</div>
                  <div style="margin-top:4px;font-size:14px;font-weight:700;">${meta}</div>
                </td>
              </tr>
              <tr>
                <td style="padding:12px 14px;border-radius:12px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.10);">
                  <div style="font-size:12px;color:rgba(229,231,235,0.70);">H1 count</div>
                  <div style="margin-top:4px;font-size:14px;font-weight:700;">${h1}</div>
                </td>
              </tr>
            </table>

            <div style="margin-top:16px;display:flex;gap:10px;flex-wrap:wrap;">
              <a href="${bookCallUrl}"
                 style="display:inline-block;padding:12px 14px;border-radius:12px;background:rgba(92,200,255,0.18);border:1px solid rgba(92,200,255,0.40);color:#eaf6ff;text-decoration:none;font-weight:800;">
                 Book a quick review call
              </a>

              <a href="mailto:support@shorelinedevco.com"
                 style="display:inline-block;padding:12px 14px;border-radius:12px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.14);color:#f9fafb;text-decoration:none;font-weight:800;">
                 Reply for help
              </a>
            </div>

            <div style="margin-top:14px;font-size:12px;color:rgba(229,231,235,0.65);line-height:1.5;">
              This email was generated automatically after a website scan. If you did not request this, you can ignore it.
            </div>
          </div>
        </div>
      </div>

      <div style="margin-top:14px;text-align:center;font-size:11px;color:rgba(229,231,235,0.55);">
        Shoreline Dev Co
      </div>
    </div>
  </body>
</html>`;
}

async function sendBeaconReportEmail({ to, subject, report, businessNameValue, websiteValue }) {
  if (!to) return;

  if (!resend || !EMAIL_FROM) {
    console.warn("Resend not configured. Skipping email send.");
    return;
  }

  const text = buildEmailText({ businessNameValue, websiteValue, report });
  const html = buildEmailHtml({ businessNameValue, websiteValue, report });

  // Quick visibility in terminal
  console.log("EMAIL MODE CHECK:", { hasHtml: html.length, hasText: text.length });

  try {
    const response = await resend.emails.send({
      from: EMAIL_FROM,
      to,
      bcc: INTERNAL_BCC_EMAIL ? [INTERNAL_BCC_EMAIL] : undefined,
      reply_to: "support@shorelinedevco.com",
      subject,
      text,
      html
    });

    console.log("Resend response:", response);
  } catch (err) {
    console.error("Email send failed:", err?.message || err);
  }
}

async function logEvent({ eventType, email, urlHash, domain, tier, meta }) {
  try {
    const { error } = await supabase.from(EVENTS_TABLE).insert({
      event_type: eventType,
      email: email || null,
      url_hash: urlHash || null,
      domain: domain || null,
      recommended_tier: tier || null,
      meta: meta || null
    });

    if (error) console.error("Event insert failed:", error.message);
  } catch (err) {
    console.error("Event insert exception:", err?.message || err);
  }
}

//
// Routes
//

app.get("/health", (req, res) => {
  res.json({ ok: true, message: "Beacon AI backend running" });
});

// Redirect + event tracking
app.get("/r", async (req, res) => {
  try {
    const to = safeString(req.query.to);
    const eventType = safeString(req.query.e) || "click";
    const urlHash = safeString(req.query.h);
    const domain = safeString(req.query.d);
    const tier = safeString(req.query.t);

    if (!to || !/^https?:\/\//i.test(to)) {
      return res.status(400).send("Bad redirect");
    }

    await logEvent({
      eventType,
      email: null, // keeping links privacy friendly for now
      urlHash: urlHash || null,
      domain: domain || null,
      tier: tier || null,
      meta: {
        user_agent: req.get("user-agent") || null,
        referer: req.get("referer") || null
      }
    });

    return res.redirect(302, to);
  } catch (err) {
    console.error("Redirect error:", err?.message || err);
    return res.status(500).send("Error");
  }
});

app.post("/api/analyze", async (req, res) => {
  console.log("BODY RECEIVED >>>", req.body);

  try {
    const { name, email, website, businessName, business_name, refresh } = req.body || {};
    const finalBusinessName = (businessName || business_name || "").trim();

    if (!email || !website) {
      return res.status(400).json({ ok: false, error: "Website and email are required." });
    }

    const cleanEmail = String(email).trim().toLowerCase();

    if (!isValidEmailFormat(cleanEmail)) {
      return res.status(400).json({ ok: false, error: "Invalid email. Please enter a real email address." });
    }

    const hasMx = await emailHasMx(cleanEmail);
    if (!hasMx) {
      return res.status(400).json({
        ok: false,
        error: "That email domain cannot receive email. Please use a real email."
      });
    }

    const normalized = normalizeUrl(website);
    if (!normalized) {
      return res.status(400).json({ ok: false, error: "Invalid website URL." });
    }

    const urlHash = hashString(normalized);

    // Cache lookup
    const { data: cachedReport, error: cacheErr } = await supabase
      .from(REPORTS_TABLE)
      .select("*")
      .eq("url_hash", urlHash)
      .maybeSingle();

    if (cacheErr) {
      return res.status(500).json({ ok: false, error: cacheErr.message });
    }

    // If cached
    if (cachedReport) {
      console.log("CACHE HIT:", { domain: normalized, refresh: Boolean(refresh) });

      const recommendation = recommendPackageFromReport(cachedReport);

      await saveLead({
        email: cleanEmail,
        businessName: finalBusinessName,
        name,
        domain: normalized,
        urlHash,
        score: cachedReport.score,
        summary: cachedReport.summary,
        recommendation
      });

      // If refresh true, resend the cached report email
      if (refresh === true) {
        await sendBeaconReportEmail({
          to: cleanEmail,
          subject: "Your Beacon AI website report",
          report: cachedReport,
          businessNameValue: finalBusinessName || normalized,
          websiteValue: website
        });
      }

      return res.json({
        ok: true,
        cached: true,
        report: cachedReport
      });
    }

    // No cache
    console.log("CACHE MISS:", { domain: normalized });

    // Fake analysis for now
    const report = {
      url_hash: urlHash,
      domain: normalized,
      score: 65,
      summary: "Solid foundation, but performance, SEO, and conversion clarity can be improved."
    };

    const { error: insertErr } = await supabase.from(REPORTS_TABLE).insert(report);
    if (insertErr) {
      return res.status(500).json({ ok: false, error: insertErr.message });
    }

    const recommendation = recommendPackageFromReport(report);

    await saveLead({
      email: cleanEmail,
      businessName: finalBusinessName,
      name,
      domain: normalized,
      urlHash,
      score: report.score,
      summary: report.summary,
      recommendation
    });

    // Always email on fresh report
    await sendBeaconReportEmail({
      to: cleanEmail,
      subject: "Your Beacon AI website report",
      report,
      businessNameValue: finalBusinessName || normalized,
      websiteValue: website
    });

    return res.json({
      ok: true,
      cached: false,
      report
    });
  } catch (err) {
    console.error("ANALYZE ERROR:", err);
    return res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
});

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
