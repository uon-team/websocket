

export const WEBSOCKET_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

export enum WsErrorCode {
    NormalClosure = 1000,
    GoingAway,
    ProtocolError,
    UnsupportedData,
    NoStatusReceived = 1005,
    AbnormalClosure,
    UnsupportedPayload,
    PolicyViolation,
    PayloadTooLarge,
    MandatoryExtension,
    ServerError,
    ServiceRestart,
    TryAgainLater,
    BadGateway,
    TLSHandshakeFail

}

export function IsValidStatusCode(code: number) {
    return (
        (code >= 1000 &&
            code <= 1013 &&
            code !== 1004 &&
            code !== 1005 &&
            code !== 1006) ||
        (code >= 3000 && code <= 4999)
    );
};

