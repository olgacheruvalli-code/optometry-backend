const API_BASE =
  process.env.REACT_APP_API_BASE ||   // Vercel / Production
  "http://127.0.0.1:5000";            // Local development

export default API_BASE;
