import { useEffect, type ReactNode } from "react";
import { App, ConfigProvider } from "antd";
import zhCN from "antd/es/locale/zh_CN";
import { getAntThemeConfig } from "@/lib/app-theme";

export function AppProviders({ children }: { children: ReactNode }) {
    useEffect(() => {
        document.documentElement.classList.remove("dark");
        document.documentElement.style.colorScheme = "light";
        document.documentElement.lang = "zh-CN";
        document.title = "照片修复";
    }, []);
    return <ConfigProvider locale={zhCN} theme={getAntThemeConfig(false)}><App>{children}</App></ConfigProvider>;
}
