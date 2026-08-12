import { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
    pi.on("session_start", async(_event, ctx) => {
        ctx.ui.notify("Awareness loading", "info");
        // 加载 engine
        
        // 注册 adapters

        // 注册 SKILL
    });
}