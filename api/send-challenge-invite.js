export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.INVITE_FROM_EMAIL || "Billard Scoreboard <onboarding@resend.dev>";

  if (!apiKey) {
    return res.status(503).json({ error: "mail_not_configured", message: "RESEND_API_KEY fehlt." });
  }

  try {
    const body = req.body || {};
    const to = String(body.to || "").trim().toLowerCase();
    const hostName = String(body.hostName || "Spieler 1").trim();
    const guestName = String(body.guestName || "Spieler 2").trim();
    const hostDiscipline = String(body.hostDiscipline || "-").trim();
    const guestDiscipline = String(body.guestDiscipline || "-").trim();
    const durationMinutes = Number(body.durationMinutes || 0);
    const sessionId = String(body.sessionId || "").trim();
    const appBaseUrl = String(body.appBaseUrl || "").trim();

    if (!to || !to.includes("@")) {
      return res.status(400).json({ error: "invalid_to" });
    }

    const safeBase = appBaseUrl || "https://billard-scoreboard.vercel.app";
    const joinUrl = `${safeBase.replace(/\/+$/, "")}/training_countdown_hs_run.html?session=${encodeURIComponent(sessionId)}`;
    const durationText = durationMinutes > 0 ? `${durationMinutes} min` : "-";
    const subject = `Challenge-Einladung: ${hostName} vs ${guestName}`;

    const html = `
      <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111827">
        <h2 style="margin:0 0 12px">Challenge-Einladung</h2>
        <p style="margin:0 0 10px"><strong>${hostName}</strong> hat dich zu einer Countdown-Challenge eingeladen.</p>
        <p style="margin:0 0 14px">
          Match: ${hostName} (${hostDiscipline}) vs ${guestName} (${guestDiscipline})<br/>
          Dauer: ${durationText}
        </p>
        <p style="margin:0 0 16px">
          <a href="${joinUrl}" style="display:inline-block;padding:10px 14px;background:#2f4fe0;color:#ffffff;text-decoration:none;border-radius:8px;">
            Jetzt beitreten
          </a>
        </p>
        <p style="margin:0;color:#6b7280;font-size:12px">Falls der Button nicht geht, Link kopieren:<br/>${joinUrl}</p>
      </div>
    `;

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject,
        html
      })
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return res.status(response.status).json({
        error: "mail_send_failed",
        provider: "resend",
        details: payload
      });
    }

    return res.status(200).json({ ok: true, provider: "resend", id: payload?.id || null });
  } catch (error) {
    return res.status(500).json({
      error: "mail_send_exception",
      message: error?.message || "unknown_error"
    });
  }
}

