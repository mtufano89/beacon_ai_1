import { useMemo, useState } from "react";
import { analyzeWebsite } from "./api.js";
import beaconLogo from "./assets/beacon-logo.png";

export default function App() {
  // Update these later if you want
  const SUPPORT_EMAIL = "support@shorelinedevco.com";
  const BOOK_CALL_URL = "https://shorelinedevco.com/contact";

  // Form state (simple)
  const [website, setWebsite] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");

  // App stateF
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  // -------------------------
  // Helpers
  // -------------------------
  function normalizeWebsite(input) {
    const value = (input || "").trim();
    if (!value) return "";
    if (value.startsWith("http://") || value.startsWith("https://")) return value;
    return `https://${value}`;
  }

  function isValidEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((value || "").trim());
  }

  function buildIssues(report) {
    const issues = [];
    const title = (report?.title || "").trim();
    const meta = (report?.meta_description || "").trim();
    const h1Raw = report?.h1_count;
    const h1 = Number(h1Raw);

    if (!title) issues.push({ key: "title_missing", label: "Missing page title (<title>)", severity: "high" });
    if (!meta) issues.push({ key: "meta_missing", label: "Missing meta description", severity: "medium" });

    if (h1Raw === null || h1Raw === undefined || Number.isNaN(h1)) {
      issues.push({ key: "h1_unknown", label: "Could not detect H1 count", severity: "low" });
    } else if (h1 === 0) {
      issues.push({ key: "h1_missing", label: "No H1 found (add one clear page headline)", severity: "high" });
    } else if (h1 > 1) {
      issues.push({ key: "h1_multiple", label: `Multiple H1 tags found (${h1}). Use one main H1.`, severity: "medium" });
    }

    return issues;
  }

  function scoreFromIssues(issues) {
    let score = 100;
    for (const i of issues) {
      if (i.severity === "high") score -= 20;
      else if (i.severity === "medium") score -= 10;
      else score -= 5;
    }
    return Math.max(0, Math.min(100, score));
  }

  function scoreLabel(score) {
    if (score >= 90) return { text: "Excellent", tone: "good" };
    if (score >= 70) return { text: "Good", tone: "ok" };
    if (score >= 50) return { text: "Needs Work", tone: "warn" };
    return { text: "High Priority", tone: "bad" };
  }

  function toneStyles(tone) {
    if (tone === "good") return { bg: "rgba(34,197,94,0.14)", border: "rgba(34,197,94,0.35)", text: "#a7f3d0" };
    if (tone === "ok") return { bg: "rgba(59,130,246,0.14)", border: "rgba(59,130,246,0.35)", text: "#bfdbfe" };
    if (tone === "warn") return { bg: "rgba(234,179,8,0.14)", border: "rgba(234,179,8,0.35)", text: "#fde68a" };
    return { bg: "rgba(239,68,68,0.14)", border: "rgba(239,68,68,0.35)", text: "#fecaca" };
  }

  function severityPill(severity) {
    if (severity === "high") return { bg: "rgba(239,68,68,0.14)", border: "rgba(239,68,68,0.35)", text: "#fecaca" };
    if (severity === "medium") return { bg: "rgba(234,179,8,0.14)", border: "rgba(234,179,8,0.35)", text: "#fde68a" };
    return { bg: "rgba(148,163,184,0.14)", border: "rgba(148,163,184,0.35)", text: "#e2e8f0" };
  }

  function recommendPackage(bn, score, issues) {
    const has = (k) => issues.some((i) => i.key === k);

    if (issues.length === 0 && score >= 95) {
      return {
        name: "Growth + Performance Tune Up",
        reason: `Your site for ${bn} looks strong on the basics. Next wins usually come from speed, conversion clarity, and advanced SEO.`,
        bullets: ["Speed and performance improvements", "Conversion focused CTA and layout tweaks", "Advanced SEO and tracking setup"]
      };
    }

    if (has("title_missing") || has("meta_missing")) {
      return {
        name: "SEO Starter Fix Pack",
        reason: "Your site is missing key on page SEO fundamentals that help search engines understand and rank your pages.",
        bullets: ["Write or improve titles and meta descriptions", "Heading structure cleanup (H1, H2, H3)", "Basic technical SEO checks"]
      };
    }

    if (has("h1_missing") || has("h1_multiple") || has("h1_unknown")) {
      return {
        name: "Content + Structure Cleanup",
        reason: "Your heading structure needs cleanup so visitors and search engines can understand the page quickly.",
        bullets: ["Add a clear main headline (single H1)", "Improve section headings (H2, H3)", "Tighten layout for clarity"]
      };
    }

    return {
      name: "Website Improvement Audit",
      reason: "We found opportunities to improve performance, SEO, and conversion clarity. A short audit will tell us the best next move.",
      bullets: ["Quick technical review", "Top 5 highest impact fixes", "Recommended plan and package"]
    };
  }

  function buildEmailBody({ businessNameValue, websiteValue, scoreValue, report, issues, recommendation }) {
    const lines = [];
    lines.push(`Business: ${businessNameValue}`);
    lines.push(`Website: ${websiteValue}`);
    lines.push(`Score: ${scoreValue}`);
    lines.push("");
    lines.push("Summary:");
    lines.push(report?.summary || "Not available");
    lines.push("");
    lines.push(`Title: ${report?.title || "Not found"}`);
    lines.push(`Meta Description: ${report?.meta_description || "Not found"}`);
    lines.push(`H1 Count: ${report?.h1_count ?? "Not found"}`);
    lines.push("");
    lines.push("What we found:");
    if (!issues.length) lines.push("No major issues found from basic checks.");
    else for (const i of issues) lines.push(`- ${i.label} (${i.severity})`);
    lines.push("");
    lines.push("Recommended next step:");
    lines.push(recommendation?.name || "Not available");
    if (recommendation?.reason) lines.push(recommendation.reason);
    if (recommendation?.bullets?.length) {
      lines.push("");
      lines.push("Included:");
      for (const b of recommendation.bullets) lines.push(`- ${b}`);
    }
    return lines.join("\n");
  }

  async function runAnalysis({ refresh }) {
    const bn = businessName.trim();
    const em = email.trim();
    const normalizedWebsite = normalizeWebsite(website);

    if (!normalizedWebsite) return setError("Website is required.");
    if (!bn) return setError("Business name is required.");
    if (!em) return setError("Email is required.");
    if (!isValidEmail(em)) return setError("Please enter a valid email address.");

    setLoading(true);
    setError("");
    setResult(null);

    try {
      const data = await analyzeWebsite({
        name,
        email: em,
        website: normalizedWebsite,
        refresh
      });

      setResult(data.report ?? data);
    } catch (err) {
      console.error(err);
      setError(
        err?.error ||
          err?.message ||
          "Analysis failed. Please check your inputs and try again."
      );
    } finally {
      setLoading(false);
    }
  }

  const normalizedWebsiteForDisplay = useMemo(() => normalizeWebsite(website), [website]);
  const issues = useMemo(() => (result ? buildIssues(result) : []), [result]);
  const computedScore = useMemo(() => (result ? scoreFromIssues(issues) : null), [result, issues]);

  const recommendation = useMemo(() => {
    if (!result || computedScore === null) return null;
    return recommendPackage(businessName.trim() || "your business", computedScore, issues);
  }, [result, computedScore, issues, businessName]);

  const scoreInfo = computedScore === null ? null : scoreLabel(computedScore);
  const scoreTone = scoreInfo ? toneStyles(scoreInfo.tone) : null;

  function handleBookCall() {
    window.open(BOOK_CALL_URL, "_blank", "noopener,noreferrer");
  }

  function handleEmailResults() {
    if (!result || computedScore === null) return;
    const bn = businessName.trim() || "Business";
    const site = normalizedWebsiteForDisplay || "Website";
    const subject = `Beacon AI Report for ${bn}`;
    const body = buildEmailBody({
      businessNameValue: bn,
      websiteValue: site,
      scoreValue: computedScore,
      report: result,
      issues,
      recommendation
    });

    const mailto = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.location.href = mailto;
  }

  // -------------------------
  // Simple clean SVG icons
  // -------------------------
  const IconBox = ({ children }) => (
    <span style={styles.iconBox} aria-hidden="true">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
        {children}
      </svg>
    </span>
  );

  const GlobeIcon = () => (
    <IconBox>
      <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z" stroke="currentColor" strokeWidth="1.8" />
      <path d="M3.6 9h16.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M3.6 15h16.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path
        d="M12 3c2.6 2.4 4 5.7 4 9s-1.4 6.6-4 9c-2.6-2.4-4-5.7-4-9s1.4-6.6 4-9Z"
        stroke="currentColor"
        strokeWidth="1.8"
      />
    </IconBox>
  );

  const BuildingIcon = () => (
    <IconBox>
      <path d="M5 20V7.5L12 4l7 3.5V20" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M9 20v-4h6v4" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path
        d="M8 10h.01M12 10h.01M16 10h.01M8 13h.01M12 13h.01M16 13h.01"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </IconBox>
  );

  const UserIcon = () => (
    <IconBox>
      <path d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4Z" stroke="currentColor" strokeWidth="1.8" />
      <path d="M4 20a8 8 0 0 1 16 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </IconBox>
  );

  const MailIcon = () => (
    <IconBox>
      <path d="M4.5 6.5h15v11h-15v-11Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path
        d="M5.5 7.5 12 12l6.5-4.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </IconBox>
  );

  // -------------------------
  // Styles: FULL WIDTH PAGE
  // -------------------------
  const styles = {
    page: {
      minHeight: "100vh",
      width: "100%",
      color: "#e5e7eb",
      background: `
        radial-gradient(900px 700px at 20% 10%, rgba(92,200,255,0.20) 0%, rgba(0,0,0,0) 60%),
        radial-gradient(900px 700px at 80% 30%, rgba(43,123,255,0.16) 0%, rgba(0,0,0,0) 60%),
        linear-gradient(180deg, #041024 0%, #020617 100%)
      `
    },

    shell: {
      minHeight: "100vh",
      width: "100%",
      padding: "44px 16px 70px",
      position: "relative",
      overflow: "hidden"
    },

    stars: {
      position: "absolute",
      inset: 0,
      pointerEvents: "none",
      backgroundImage: `
        radial-gradient(1px 1px at 20px 30px, rgba(255,255,255,0.55) 40%, rgba(255,255,255,0) 42%),
        radial-gradient(1px 1px at 160px 90px, rgba(255,255,255,0.40) 40%, rgba(255,255,255,0) 42%),
        radial-gradient(1px 1px at 260px 160px, rgba(255,255,255,0.35) 40%, rgba(255,255,255,0) 42%),
        radial-gradient(1px 1px at 60px 190px, rgba(255,255,255,0.30) 40%, rgba(255,255,255,0) 42%),
        radial-gradient(1px 1px at 360px 50px, rgba(255,255,255,0.35) 40%, rgba(255,255,255,0) 42%),
        radial-gradient(1px 1px at 460px 150px, rgba(255,255,255,0.28) 40%, rgba(255,255,255,0) 42%)
      `,
      backgroundSize: "520px 260px",
      opacity: 0.35
    },

    circuits: {
      position: "absolute",
      inset: 0,
      pointerEvents: "none",
      opacity: 0.18,
      backgroundImage:
        `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1400' height='900' viewBox='0 0 1400 900'%3E%3Cg fill='none' stroke='%235cc8ff' stroke-opacity='0.55' stroke-width='1'%3E%3Cpath d='M80 160h260v120h180v140h220'/%3E%3Cpath d='M220 740h240v-160h240v-140h220'/%3E%3Cpath d='M980 120h180v180h140'/%3E%3Cpath d='M1040 760h220v-220h120'/%3E%3Ccircle cx='340' cy='160' r='6'/%3E%3Ccircle cx='520' cy='280' r='6'/%3E%3Ccircle cx='700' cy='420' r='6'/%3E%3Ccircle cx='460' cy='740' r='6'/%3E%3Ccircle cx='940' cy='440' r='6'/%3E%3Ccircle cx='1160' cy='300' r='6'/%3E%3Ccircle cx='1040' cy='760' r='6'/%3E%3C/g%3E%3C/svg%3E")`,
      backgroundRepeat: "no-repeat",
      backgroundPosition: "center",
      backgroundSize: "cover"
    },

    // Full width container that centers content but allows it to be wide on desktop
    content: {
      width: "100%",
      maxWidth: "100%",
      padding: "0 48px",
      boxSizing: "border-box",
      position: "relative",
      zIndex: 2
    },

    // Form area width (the card) - wide on desktop, still centered
    cardWrap: {
      width: "100%",
      maxWidth: 980,
      margin: "0 auto"
    },

    brandRow: {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  margin: "0 0 18px",
  padding: 0
},

logoWrap: {
  position: "relative",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "8px",
  borderRadius: 999
},

logoGlow: {
  position: "absolute",
  inset: "-28px",
  borderRadius: 999,
  background:
    "radial-gradient(circle at 50% 50%, rgba(92,200,255,0.35) 0%, rgba(43,123,255,0.18) 35%, rgba(0,0,0,0) 70%)",
  filter: "blur(18px)",
  opacity: 0.1,
  pointerEvents: "none"
},

logoImg: {
  position: "relative",
  height: 170,
  width: "auto",
  display: "block",
  objectFit: "contain",
  borderRadius: 24,
  background: "transparent",
  border: "none",
  padding: 0,
  boxShadow: "0 28px 90px rgba(0,0,0,0.65)",
  filter: "drop-shadow(0 0 26px rgba(92,200,255,0.35))"
},

    card: {
      borderRadius: 22,
      padding: 22,
      background: "linear-gradient(180deg, rgba(255,255,255,0.12), rgba(255,255,255,0.06))",
      border: "1px solid rgba(255,255,255,0.16)",
      boxShadow: "0 26px 80px rgba(0,0,0,0.55)",
      backdropFilter: "blur(10px)"
    },
    cardInner: {
      borderRadius: 18,
      padding: 18,
      background: "rgba(255,255,255,0.04)",
      border: "1px solid rgba(255,255,255,0.10)"
    },
    title: {
      margin: 0,
      textAlign: "center",
      fontSize: 30,
      fontWeight: 950,
      letterSpacing: -0.3
    },
    subtitle: {
      margin: "10px 0 18px",
      textAlign: "center",
      color: "rgba(229,231,235,0.72)",
      lineHeight: 1.55
    },

    field: { marginBottom: 12 },

    inputWrap: {
      display: "flex",
      alignItems: "center",
      gap: 10,
      borderRadius: 14,
      border: "1px solid rgba(255,255,255,0.18)",
      background: "rgba(255,255,255,0.07)",
      padding: "12px 12px"
    },

   

    input: {
      width: "100%",
      background: "transparent",
      border: "none",
      outline: "none",
      color: "#f9fafb",
      fontSize: 16
    },

    help: { marginTop: 6, fontSize: 12, color: "rgba(229,231,235,0.72)" },

    error: {
      marginTop: 12,
      padding: 12,
      borderRadius: 14,
      border: "1px solid rgba(239,68,68,0.35)",
      background: "rgba(239,68,68,0.12)"
    },

    primaryBtn: {
      width: "100%",
      marginTop: 12,
      padding: "14px 16px",
      borderRadius: 16,
      border: "1px solid rgba(92,200,255,0.45)",
      background: "linear-gradient(180deg, rgba(92,200,255,0.26), rgba(43,123,255,0.18))",
      color: "#eaf6ff",
      fontWeight: 900,
      fontSize: 16,
      cursor: "pointer",
      boxShadow: "0 18px 40px rgba(0,0,0,0.40)"
    },

    secondaryRow: {
      display: "flex",
      gap: 10,
      marginTop: 10,
      flexWrap: "wrap"
    },

    smallBtn: {
      flex: 1,
      minWidth: 180,
      padding: "12px 14px",
      borderRadius: 14,
      border: "1px solid rgba(255,255,255,0.18)",
      background: "rgba(255,255,255,0.06)",
      color: "#f9fafb",
      fontWeight: 900,
      cursor: "pointer"
    },

    disabled: { opacity: 0.6, cursor: "not-allowed" },

    trust: { marginTop: 12, textAlign: "center", fontSize: 13, color: "rgba(229,231,235,0.70)" },

    resultsWrap: {
      width: "100%",
      maxWidth: 980,
      margin: "18px auto 0",
      display: "grid",
      gap: 12
    },

    panel: {
      borderRadius: 18,
      padding: 18,
      background: "rgba(0,0,0,0.22)",
      border: "1px solid rgba(255,255,255,0.12)"
    },

    kpiRow: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" },
    scoreNum: { fontSize: 40, fontWeight: 950, lineHeight: 1 },
    pill: { padding: "10px 12px", borderRadius: 999, fontWeight: 900 },

    divider: { border: "none", borderTop: "1px solid rgba(255,255,255,0.12)", margin: "14px 0" },
    sectionTitle: { margin: 0, fontSize: 16, fontWeight: 900 },

    listItem: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      gap: 10,
      padding: 12,
      borderRadius: 14,
      border: "1px solid rgba(255,255,255,0.10)",
      background: "rgba(255,255,255,0.04)"
    }
  };

  return (
    <div style={styles.page}>
      <div style={styles.shell}>
        <div style={styles.stars} />
        <div style={styles.circuits} />

        <div style={styles.content}>
          {/* Logo (changed wrapper from h1 to div) */}
          <div style={styles.brandRow}>
  <div style={styles.logoWrap}>
    <div style={styles.logoGlow} />
    <img src={beaconLogo} alt="Beacon AI" style={styles.logoImg} />
  </div>
</div>


          <div style={styles.cardWrap}>
            <div style={styles.card}>
              <div style={styles.cardInner}>
                <h2 style={styles.title}>Get a free website analysis</h2>
                <div style={styles.subtitle}>
                  We&apos;ll scan your site and identify what&apos;s holding it back. Then we&apos;ll recommend a clear next step.
                </div>

                {/* Website */}
                <div style={styles.field}>
                  <div style={styles.inputWrap}>
                    <GlobeIcon />
                    <input
                      value={website}
                      onChange={(e) => setWebsite(e.target.value)}
                      placeholder="Your website URL"
                      style={styles.input}
                      required
                    />
                  </div>
                  <div style={styles.help}>
                    We will analyze:{" "}
                    <span style={{ color: "#fff" }}>{normalizedWebsiteForDisplay || "Enter a site above"}</span>
                  </div>
                </div>

                {/* Business name */}
                <div style={styles.field}>
                  <div style={styles.inputWrap}>
                    <BuildingIcon />
                    <input
                      value={businessName}
                      onChange={(e) => setBusinessName(e.target.value)}
                      placeholder="Your business name"
                      style={styles.input}
                      required
                    />
                  </div>
                </div>

                {/* Name */}
                <div style={styles.field}>
                  <div style={styles.inputWrap}>
                    <UserIcon />
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Your name (optional)"
                      style={styles.input}
                    />
                  </div>
                </div>

                {/* Email */}
                <div style={styles.field}>
                  <div style={styles.inputWrap}>
                    <MailIcon />
                    <input
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="Your email (required)"
                      style={styles.input}
                      type="email"
                      required
                    />
                  </div>
                  <div style={styles.help}>Required so we can send you your results.</div>
                </div>

                <button
                  type="button"
                  onClick={() => runAnalysis({ refresh: false })}
                  disabled={loading}
                  style={{ ...styles.primaryBtn, ...(loading ? styles.disabled : null) }}
                >
                  {loading ? "Running Analysis..." : "Run My Free Analysis"}
                </button>

                <div style={styles.secondaryRow}>
                  <button
                    type="button"
                    onClick={() => runAnalysis({ refresh: true })}
                    disabled={loading}
                    style={{ ...styles.smallBtn, ...(loading ? styles.disabled : null) }}
                  >
                    Refresh Scan
                  </button>

                  <button type="button" onClick={handleBookCall} style={styles.smallBtn}>
                    Contact Shoreline Dev Co
                  </button>
                </div>

                <div style={styles.trust}>No spam. No obligation.</div>

                {error && (
                  <div style={styles.error}>
                    <strong style={{ color: "#fecaca" }}>Fix this:</strong> {error}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Results */}
          {result && computedScore !== null && (
            <div style={styles.resultsWrap}>
              <div style={styles.panel}>
                <div style={styles.kpiRow}>
                  <div>
                    <div style={{ fontSize: 13, color: "rgba(229,231,235,0.75)" }}>Score</div>
                    <div style={styles.scoreNum}>{computedScore}</div>
                  </div>

                  <div
                    style={{
                      ...styles.pill,
                      border: `1px solid ${scoreTone.border}`,
                      background: scoreTone.bg,
                      color: scoreTone.text
                    }}
                  >
                    {scoreInfo.text}
                  </div>
                </div>

                <hr style={styles.divider} />

                <div style={{ display: "grid", gap: 10 }}>
                  <div>
                    <div style={{ fontSize: 13, color: "rgba(229,231,235,0.75)" }}>Summary</div>
                    <div style={{ marginTop: 6, lineHeight: 1.6 }}>{result.summary}</div>
                  </div>

                  <div style={{ display: "grid", gap: 6 }}>
                    <div>
                      <strong>Title:</strong> {result.title || "Not found"}
                    </div>
                    <div>
                      <strong>Meta Description:</strong> {result.meta_description || "Not found"}
                    </div>
                    <div>
                      <strong>H1 Count:</strong> {result.h1_count ?? "Not found"}
                    </div>
                  </div>

                  {result.updated_at && (
                    <div style={{ fontSize: 12, color: "rgba(229,231,235,0.70)" }}>
                      Last analyzed: {new Date(result.updated_at).toLocaleString()}
                    </div>
                  )}
                </div>
              </div>

              <div style={styles.panel}>
                <h3 style={styles.sectionTitle}>What We Found</h3>

                <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
                  {issues.length === 0 ? (
                    <div
                      style={{
                        padding: 12,
                        borderRadius: 14,
                        border: "1px solid rgba(34,197,94,0.35)",
                        background: "rgba(34,197,94,0.12)",
                        color: "#a7f3d0"
                      }}
                    >
                      No major issues found from basic checks.
                    </div>
                  ) : (
                    issues.map((i) => {
                      const pill = severityPill(i.severity);
                      return (
                        <div key={i.key} style={styles.listItem}>
                          <div style={{ lineHeight: 1.45 }}>{i.label}</div>
                          <div
                            style={{
                              padding: "6px 10px",
                              borderRadius: 999,
                              border: `1px solid ${pill.border}`,
                              background: pill.bg,
                              color: pill.text,
                              fontSize: 12,
                              fontWeight: 900,
                              textTransform: "uppercase",
                              letterSpacing: 0.6,
                              whiteSpace: "nowrap"
                            }}
                          >
                            {i.severity}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {recommendation && (
                <div style={styles.panel}>
                  <h3 style={styles.sectionTitle}>Recommended Next Step</h3>
                  <div style={{ marginTop: 8, fontSize: 20, fontWeight: 950 }}>{recommendation.name}</div>
                  <div style={{ marginTop: 10, color: "rgba(229,231,235,0.90)", lineHeight: 1.6 }}>
                    {recommendation.reason}
                  </div>

                  <ul style={{ marginTop: 12, marginBottom: 0, paddingLeft: 18 }}>
                    {recommendation.bullets.map((b) => (
                      <li key={b} style={{ marginBottom: 8, lineHeight: 1.55 }}>
                        {b}
                      </li>
                    ))}
                  </ul>

                  <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <button type="button" onClick={handleBookCall} style={styles.smallBtn}>
                      Schedule a Free Review Call
                    </button>

                    <button type="button" onClick={handleEmailResults} style={styles.smallBtn}>
                      Email Me This Report
                    </button>
                  </div>

                  <div style={{ marginTop: 10, fontSize: 12, color: "rgba(229,231,235,0.70)" }}>
                    Email sends to: {SUPPORT_EMAIL}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
