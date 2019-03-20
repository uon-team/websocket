
import { parse as ParseUrl } from 'url';
import * as http from 'http';
import * as https from 'https';
import * as net from 'net';
import * as crypto from 'crypto';

import { HttpContext, HttpError } from "@uon/http";



import { WsContext, WsContextState } from './WsContext';
import { WEBSOCKET_GUID } from './WsUtils';


const SUPPORTED_PROTOCOLS = ['wss:', 'ws:'];


export interface WebSocketConnectOptions {
    origin?: string;
    headers?: { [k: string]: string };


}


/**
 * WebSocket client implementation for servers
 */
export class WebSocket extends WsContext {

    private _context: WsContext;

    /**
     * Creates a new WebSocket
     * If a url is passed as the first argument, it will attempt 
     * to connect to the specified host. In that case, make sure 
     * you set an 'open' event listener on this here WebSocket
     * @param url 
     * @param headers 
     */
    constructor(url?: string, headers: { [k: string]: string } = {}) {
        super();

        // constructed as a client
        if (typeof url === 'string') {
            this.connect(url, headers)
        }

    }

    get readyState() {
        return this._state;
    }


    /**
     * Connect to a ws server
     * @param url 
     * @param headers 
     */
    private connect(url: string, headers: { [k: string]: string }) {

        const parsed_url = ParseUrl(url);

        if (SUPPORTED_PROTOCOLS.indexOf(parsed_url.protocol) == -1) {
            throw new Error(`WebSocket: Url protocol must be one of ${SUPPORTED_PROTOCOLS}. 
                Got ${parsed_url.protocol}.`);
        }

        const use_tls = parsed_url.protocol === 'wss';
        const http_client: any = use_tls ? https : http;

        const key = crypto.randomBytes(16).toString('base64');

        headers = Object.assign({
            'Sec-WebSocket-Version': 13,
            'Sec-WebSocket-Key': key,
            'Connection': 'Upgrade',
            'Upgrade': 'websocket'
        }, headers);


        let request_options: http.RequestOptions = {
            method: 'GET',
            protocol: use_tls ? 'https:' : 'http:',
            host: parsed_url.hostname,
            path: parsed_url.path + (parsed_url.query || ''),
            port: parsed_url.port || (use_tls ? 443 : 80),
            headers: headers,

        }
        // create request
        let request: http.ClientRequest = http_client.request(request_options)

        request.on("error", (err) => {

            this._state = WsContextState.Closing;
            this.emit('error', err);
            this.close();

        });

        request.on("response", (res: http.IncomingMessage) => {
            this.abort(request.socket, `Unexpected server response: ${res.statusCode}`);
        });

        request.on("upgrade",
            (res: http.IncomingMessage, socket: net.Socket, head: Buffer) => {

                if (this.readyState !== WsContextState.Connecting) {
                    return;
                }

                const digest = crypto.createHash('sha1')
                    .update(key + WEBSOCKET_GUID, 'ascii')
                    .digest('base64');


                if (res.headers['sec-websocket-accept'] !== digest) {
                    this.abort(socket, 'Invalid Sec-WebSocket-Accept header');
                    return;
                }

                this.assignSocket(socket, head);

            });

        request.end();


    }

    private abort(socket: net.Socket, reason: string) {

        this._state = WsContextState.Closing;

        const err = new Error(reason);

        this.emit('error', err);
        this.emit('close');

        socket.destroy();

    }


    static async Upgrade(
        context: HttpContext,
        extraHeaders: http.OutgoingHttpHeaders) {

        const req = context.request;
        const socket = req.socket;
        const version = +req.headers['sec-websocket-version'];
        const upgrade = req.headers.upgrade.toLowerCase();
        const key = req.headers['sec-websocket-key'] as string;

        // test prerequisites
        if (req.method !== 'GET' ||
            upgrade !== 'websocket' ||
            !key ||
            (version !== 8 && version !== 13)) {

            throw new HttpError(400);
        }


        if (!socket.readable || !socket.writable) {
            throw new HttpError(400);
        }

        // create the response key
        const res_key = crypto.createHash('sha1')
            .update(key + WEBSOCKET_GUID, 'ascii')
            .digest('base64');

        const headers = Object.assign(extraHeaders, {
            'Upgrade': 'websocket',
            'Connection': 'Upgrade',
            'Sec-WebSocket-Accept': res_key
        });

        let res = socket.write(
            `HTTP/1.1 101 Switching Protocols\r\n` +
            Object.keys(headers).map(h => `${h}: ${headers[h]}`).join('\r\n') +
            `\r\n\r\n`
        );

        // create websocket
        let ws = new WebSocket();

        // let WsContext be a friend
        (ws as any).assignSocket(socket, context.head);

        return ws;


    }

}
