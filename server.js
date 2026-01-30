// server.js

const dns = require("dns");
dns.setDefaultResultOrder("ipv4first");
const { promises: dnsPromises } = dns;

const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
require("dotenv").config();

const { createClient } = require("@supabase/supabase-js");

const app = express();
app.use(
  cors({
    origin: "http://localhost:5173"
  })
);
app.use(express.json());

// Env vars
const SUPABASE_URL = (process.env.SUPABASE_URL || "").trim();
const SUPABASE_SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

// Tables
const REPORTS_TABLE = "beacon_ai";
const LEADS_TABLE = "beacon_ai_leads";

// Supabase client
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

//
// -------- HELPERS --------
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
  summary
}) {
  try {
    const { error } = await supabase.from(LEADS_TABLE).insert({
      email,
      business_name: (businessName || "").trim() || "Unknown Business",
      contact_name: (name || "").trim() || null,
      domain,
      url_hash: urlHash,
      score: score ?? null,
      summary: summary ?? null
    });

    if (error) console.error("Lead save failed:", error.message);
  } catch (err) {
    console.error("Lead save exception:", err.message);
  }
}

//
// -------- ROUTES --------
//

app.get("/health", (req, res) => {
  res.json({ ok: true, message: "Beacon AI backend running" });
});

app.post("/api/analyze", async (req, res) => {
  console.log("BODY RECEIVED >>>", req.body);

  try {
    const { name, email, website, businessName, business_name } = req.body || {};
    const finalBusinessName = businessName || business_name;

    // Required fields (frontend should send businessName too, but do not hard-block if missing)
    if (!email || !website) {
      return res.status(400).json({
        ok: false,
        error: "Website and email are required."
      });
    }

    const cleanEmail = String(email).trim().toLowerCase();

    // Email checks (simple but effective)
    if (!isValidEmailFormat(cleanEmail)) {
      return res.status(400).json({
        ok: false,
        error: "Invalid email. Please enter a real email address."
      });
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
      return res.status(400).json({
        ok: false,
        error: "Invalid website URL."
      });
    }

    const urlHash = hashString(normalized);

    // Check cached report
    const { data: cachedReport, error: cacheErr } = await supabase
      .from(REPORTS_TABLE)
      .select("*")
      .eq("url_hash", urlHash)
      .maybeSingle();

    if (cacheErr) {
      return res.status(500).json({ ok: false, error: cacheErr.message });
    }

    if (cachedReport) {
      await saveLead({
        email: cleanEmail,
        businessName: finalBusinessName,
        name,
        domain: normalized,
        urlHash,
        score: cachedReport.score,
        summary: cachedReport.summary
      });

      return res.json({
        ok: true,
        cached: true,
        report: cachedReport
      });
    }

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

    await saveLead({
      email: cleanEmail,
      businessName: finalBusinessName,
      name,
      domain: normalized,
      urlHash,
      score: report.score,
      summary: report.summary
    });

    return res.json({
      ok: true,
      cached: false,
      report
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.listen(3001, () => {
  console.log("Server running at http://localhost:3001");
});
