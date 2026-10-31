import React, { Suspense, lazy } from "react";
import ReactDOM from "react-dom/client";
import "./styles.css";
import "./modern-ui.css";

const App = lazy(() => import("./App.jsx"));

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <Suspense fallback={null}>
      <App />
    </Suspense>
  </React.StrictMode>
);
