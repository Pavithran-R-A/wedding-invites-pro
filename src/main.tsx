// Imported first so the auth redirect intent is recorded before App's graph evaluates
// `createClient`, whose initialization clears the URL fragment a recovery email lands on.
import "@/lib/authRedirectIntent";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

createRoot(document.getElementById("root")!).render(<App />);
