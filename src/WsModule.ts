import { Module } from "@uon/core";
import { WebSocket } from "./WebSocket";
import { HttpUpgradeHandler, HTTP_UPGRADE_HANDLER } from "@uon/http";



@Module({
    imports: [
    ],
    providers: [
        {
            token: HTTP_UPGRADE_HANDLER,
            value: <HttpUpgradeHandler<WebSocket>>{
                protocol: 'websocket',
                type: WebSocket,
                accept: WebSocket.Upgrade
            },
            multi: true
        }
    ]
})
export class WebSocketModule { }


