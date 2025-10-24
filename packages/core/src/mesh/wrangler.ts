import {HydraInstance, HydraProvider} from "@meshsdk/hydra";
import {BlockfrostProvider} from "@meshsdk/core";

const BLOCKFROST_KEY = process.env.BLOCKFROST_API_KEY as string;
if (!BLOCKFROST_KEY) throw new Error("BLOCKFROST_API_KEY not set");

export interface CommitArgs {
    txHash: string;
    txIndex: number;
}

export class Wrangler {
    private readonly BLOCKFROST_KEY: string;
    private mode: "start" | "shutdown" | undefined;
    public readonly provider: HydraProvider;
    private instance: HydraInstance;
    private readonly blockfrost: BlockfrostProvider;
    private readonly url: string;
    private readonly wsUrl: string;

    constructor(url?: string, wsUrl?: string) {
        this.url = url || (process.env.HYDRA_API_URL as string);
        this.wsUrl = wsUrl || (process.env.HYDRA_WS_URL as string);
        this.BLOCKFROST_KEY = process.env.BLOCKFROST_API_KEY as string;
        this.blockfrost = new BlockfrostProvider(this.BLOCKFROST_KEY);
        this.provider = this.createHydraProvider();
        this.instance = this.createHydraInstance();
    }

    private createHydraProvider() {
        return new HydraProvider({httpUrl: this.url, history: false});
    }

    private createHydraInstance() {
        return new HydraInstance({
            provider: this.provider,
            fetcher: this.blockfrost,
            submitter: this.provider,
        });
    }

    public async connect() {
        return await this.provider.connect();
    }

    public async startHead(txHash: string, txIndex: number) {
        this.mode = "start";
        this.provider.onMessage(msg => this.handleIncoming(msg, {txHash, txIndex}));
        await this.provider.connect();
    }

    public async shutdownHead() {
        this.mode = "shutdown";
        this.provider.onMessage(msg => this.handleIncoming(msg));
        await this.provider.connect();
    }

    public async waitForHeadClose(timeoutMs: 180000): Promise<void> {
        this.mode = "shutdown";
        return new Promise(async (resolve, reject) => {
            let settled = false;

            const handle = async (message: any) => {
                try {
                    console.log("Message received: ", message.tag, message);
                    switch (message.tag) {
                        case "HeadIsClosed":
                        case "HeadIsFinalized":
                            if (settled) return;
                            settled = true;
                            resolve();
                            break;
                        case "ReadyToFanout":
                            if (settled) return;
                            await this.provider.fanout();
                            break;
                        case "Greetings":
                            await this.onGreetings(message.headStatus);
                            break;
                    }
                } catch (err) {
                    if (!settled) {
                        settled = true;
                        reject(err);
                    }
                }
            };

            this.provider.onMessage(handle);

            try {
                await this.provider.connect();
            } catch (err) {
                if (!settled) {
                    settled = true;
                    return reject(new Error("Failed to connect to Hydra provider: " + String(err)));
                }
            }

            const timer = setTimeout(() => {
                if (!settled) {
                    settled = true;
                    reject(new Error("Timeout waiting for head to close!"));
                }
            }, timeoutMs);

            const finalizer = () => clearTimeout(timer);

            const origResolve = resolve;
            const origReject = reject;

            resolve = (v?: void | PromiseLike<void>) => {
                finalizer();
                origResolve(v);
            };

            reject = (e: any) => {
                finalizer();
                origReject(e);
            };
        });
    }

    public async waitForHeadOpen(commitArgs: { txHash: string, txIndex: number }, timeoutMs = 180000): Promise<void> {
        this.mode = "start";
        return new Promise(async (resolve, reject) => {
            let settled = false;

            const handle = async (message: any) => {
                try {
                    if (message.tag === "HeadIsOpen") {
                        if (settled) return;
                        settled = true;
                        resolve();
                    } else if (message.tag === "HeadIsInitializing") {
                        if (!commitArgs) return;
                        await this.doCommit(commitArgs);
                    } else if (message.tag === "Greetings") {
                        await this.onGreetings(message.headStatus, commitArgs);
                    }
                } catch (err) {
                    if (!settled) {
                        settled = true;
                        reject(err);
                    }
                }
            };

            this.provider.onMessage(handle);

            try {
                await this.provider.connect();
            } catch (err) {
                if (!settled) {
                    settled = true;
                    return reject(new Error("Failed to connect to Hydra provider: " + String(err)));
                }
            }

            const timer = setTimeout(() => {
                if (!settled) {
                    settled = true;
                    reject(new Error("Timeout waiting for head to open"));
                }
            }, timeoutMs);

            const finalizer = () => clearTimeout(timer);

            const origResolve = resolve;
            const origReject = reject;

            resolve = (v?: void | PromiseLike<void>) => {
                finalizer();
                origResolve(v);
            };

            reject = (e: any) => {
                finalizer();
                origReject(e);
            };
        });
    }

    public async getHeadStatus(timeoutMs = 5000): Promise<string> {
        return new Promise(async (resolve, reject) => {
            let settled = false;

            const handle = (message: any) => {
                if (settled) return;
                if (message.tag === "Greetings") {
                    settled = true;
                    resolve(message.headStatus as string);
                }
            };

            this.provider.onMessage(handle);

            try {
                await this.provider.connect();
            } catch (err) {
                if (!settled) {
                    settled = true;
                    return reject(new Error("Failed to connect to Hydra provider: " + String(err)));
                }
            }

            const timer = setTimeout(() => {
                if (!settled) {
                    settled = true;
                    reject(new Error("Timeout waiting for head to open"));
                }
            }, timeoutMs);

            const finalizer = () => clearTimeout(timer);

            const origResolve = resolve;
            const origReject = reject;

            resolve = (v: string | PromiseLike<string>) => {
                finalizer();
                origResolve(v);
            };

            reject = (e: any) => {
                finalizer();
                origReject(e);
            };
        });
    }

    private async doCommit(commitArgs: CommitArgs) {
        try {
            const rawTx = await this.instance.commitFunds(commitArgs.txHash, commitArgs.txIndex);
            return await this.blockfrost.submitTx(rawTx);
        } catch (err: any) {
            console.error(`Commit error`, err);
            return false;
        }
    }

    private async handleIncoming(
        message: any,
        commitArgs?: CommitArgs,
    ) {
        if (message.tag === "Greetings") {
            await this.onGreetings(message.headStatus, commitArgs);
        } else {
            switch (this.mode) {
                case "start":
                    if (message.tag === "HeadIsInitializing") {
                        if (commitArgs === undefined) {
                            console.error("No commit arguments specified... aborting commit!");
                            return;
                        }
                        await this.doCommit(commitArgs);
                    }
                    if (message.tag === "HeadIsOpen") {
                        // Successfully started the head here... close gracefully?
                    }
                    break;
                case "shutdown":
                    if (message.tag === "ReadyToFanout") {
                        await this.provider.fanout();
                    }
                    break;
            }
        }
    }

    private async onGreetings(status: string, commitArgs?: CommitArgs) {
        switch (this.mode) {
            case "start":
                switch (status) {
                    case "Idle":
                        console.log("Idle → init()");
                        await this.provider.init();
                        break;
                    case "Initializing":
                        console.log("Initializing -> commit()");
                        if (commitArgs === undefined) {
                            console.error("No commit arguments specified... aborting commit!");
                            return;
                        }
                        await this.doCommit(commitArgs);
                        break;
                    case "Open":
                        console.log("Open → already ready, proceeding");
                        break;
                    default:
                        console.log(`Greetings in start mode, ignoring status: ${status}`);
                }
                break;
            case "shutdown":
                switch (status) {
                    case "Open":
                        console.log("Shutting down: closing head…");
                        await this.provider.close();
                        break;
                    case "FanoutPossible":
                        console.log("Fanout now possible: fanning out…");
                        await this.provider.fanout();
                        break;
                    default:
                        console.log(`Greetings in shutdown mode, ignoring status: ${status}`);
                }
        }
    }
}