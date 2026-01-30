export async function analyzeWebsite(payload) {
  const res = await fetch("http://localhost:3001/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const data = await res.json();

  if (!res.ok || data?.ok === false) {
    throw data;
  }

  return data;
}
