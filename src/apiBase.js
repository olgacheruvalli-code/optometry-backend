const API_BASE =
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_API_BASE) ||   // Vite
  (typeof process !== "undefined" &&
    (process.env?.REACT_APP_API_BASE || process.env?.VITE_API_BASE)) ||       // CRA / Vite fallback
  "http://127.0.0.1:5000";                                                    // default local backend

export default API_BASE;
