import React, { useEffect, useMemo, useState } from "react";

/** Small helper to hash a string -> hex (SHA-256) */
async function sha256Hex(text) {
  if (window.crypto?.subtle) {
    const enc = new TextEncoder().encode(text);
    const buf = await window.crypto.subtle.digest("SHA-256", enc);
    const bytes = new Uint8Array(buf);
    return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
  }
  // Fallback (non-cryptographic) to avoid crashes if subtle is unavailable
  let h = 0;
  for (let i = 0; i < text.length; i++) {
    h = (h << 5) - h + text.charCodeAt(i);
    h |= 0;
  }
  return ("00000000" + (h >>> 0).toString(16)).slice(-8);
}

/** Build a stable key per district+institution */
function keyFor(user) {
  const d = String(user?.district || "").trim().toLowerCase();
  const i = String(user?.institution || "").trim().toLowerCase();
  return `editPinHash::${d}::${i}`;
}

/**
 * EditGate
 * - If no password set for this district+institution: asks to set one (twice).
 * - If set: asks to enter password to unlock the Edit menu.
 * - After unlocks: renders children (the real Edit UI you already have).
 */
export default function EditGate({ user, children }) {
  const storageKey = useMemo(() => keyFor(user), [user?.district, user?.institution]);
  const [hasHash, setHasHash] = useState(false);
  const [unlocked, setUnlocked] = useState(false);

  // form state
  const [p1, setP1] = useState("");
  const [p2, setP2] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const existing = localStorage.getItem(storageKey);
    setHasHash(!!existing);
    setUnlocked(false);
    setError("");
    setP1(""); setP2(""); setPin("");
  }, [storageKey]);

  async function handleSetPassword() {
    setError("");
    if (!p1 || !p2) return setError("Enter password in both fields.");
    if (p1 !== p2) return setError("Passwords do not match.");
    const hex = await sha256Hex(p1);
    localStorage.setItem(storageKey, hex);
    setHasHash(true);
    setP1(""); setP2("");
  }

  async function handleUnlock() {
    setError("");
    const stored = localStorage.getItem(storageKey) || "";
    const hex = await sha256Hex(pin);
    if (hex !== stored) return setError("Incorrect password.");
    setUnlocked(true);
  }

  function handleClearPassword() {
    // Optional: allow removing/changing password (only when unlocked)
    localStorage.removeItem(storageKey);
    setHasHash(false);
    setUnlocked(false);
    setPin(""); setP1(""); setP2(""); setError("");
  }

  // If no password configured for this (district,institution), ask to set it.
  if (!hasHash) {
    return (
      <div className="max-w-xl mx-auto bg-white border rounded-lg shadow p-5 font-serif">
        <h2 className="text-lg font-bold mb-3">Set Edit Password</h2>
        <p className="text-sm text-gray-600 mb-4">
          This password is required to open <b>Edit Report</b> for:
          <br />
          <b>District:</b> {user?.district || "-"} &nbsp;|&nbsp;
          <b>Institution:</b> {user?.institution || "-"}
        </p>

        <label className="block text-sm text-gray-700 mb-1">New password</label>
        <input
          type="password"
          value={p1}
          onChange={(e) => setP1(e.target.value)}
          className="w-full border rounded px-3 py-2 mb-3"
        />
        <label className="block text-sm text-gray-700 mb-1">Confirm password</label>
        <input
          type="password"
          value={p2}
          onChange={(e) => setP2(e.target.value)}
          className="w-full border rounded px-3 py-2 mb-3"
        />

        {error && <div className="text-red-600 text-sm mb-3">{error}</div>}

        <button
          onClick={handleSetPassword}
          className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded"
        >
          Save Password
        </button>
      </div>
    );
  }

  // If password exists but not yet unlocked, ask to unlock.
  if (!unlocked) {
    return (
      <div className="max-w-xl mx-auto bg-white border rounded-lg shadow p-5 font-serif">
        <h2 className="text-lg font-bold mb-3">Enter Edit Password</h2>
        <p className="text-sm text-gray-600 mb-4">
          To edit saved/locked reports for:
          <br />
          <b>District:</b> {user?.district || "-"} &nbsp;|&nbsp;
          <b>Institution:</b> {user?.institution || "-"}
        </p>

        <label className="block text-sm text-gray-700 mb-1">Password</label>
        <input
          type="password"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          className="w-full border rounded px-3 py-2 mb-3"
          onKeyDown={(e) => e.key === "Enter" && handleUnlock()}
        />

        {error && <div className="text-red-600 text-sm mb-3">{error}</div>}

        <div className="flex items-center gap-2">
          <button
            onClick={handleUnlock}
            className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded"
          >
            Unlock
          </button>
          <button
            onClick={handleClearPassword}
            className="px-5 py-2 bg-gray-100 hover:bg-gray-200 rounded"
            title="Clear the existing edit password and set a new one"
          >
            Clear / Change Password
          </button>
        </div>
      </div>
    );
  }

  // Unlocked — render the real Edit UI.
  return <>{children}</>;
}
