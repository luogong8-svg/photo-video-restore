import { createBrowserRouter, Navigate } from "react-router-dom";
import RestorePage from "@/pages/restore";
import RestoreVideoPage from "@/pages/restore-video";

export const router = createBrowserRouter([
    { path: "/restore", element: <RestorePage /> },
    { path: "/restore/video", element: <RestoreVideoPage /> },
    { path: "*", element: <Navigate to="/restore" replace /> },
]);
