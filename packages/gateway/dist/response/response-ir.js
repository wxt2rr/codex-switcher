export function isTerminalGatewayResponseEvent(event) {
    return event.type === "message_end" || event.type === "error";
}
//# sourceMappingURL=response-ir.js.map