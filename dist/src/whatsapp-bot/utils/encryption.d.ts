export declare const decryptRequest: (body: any, privatePem: string, passphrase: string) => {
    decryptedBody: any;
    aesKeyBuffer: Buffer<ArrayBufferLike>;
    initialVectorBuffer: Buffer<ArrayBuffer>;
};
export declare const encryptResponse: (response: any, aesKeyBuffer: Buffer, initialVectorBuffer: Buffer) => string;
export declare const FlowEndpointException: {
    new (statusCode: number, message: string): {
        statusCode: number;
        name: string;
        message: string;
        stack?: string;
        cause?: unknown;
    };
    captureStackTrace(targetObject: object, constructorOpt?: Function): void;
    prepareStackTrace(err: Error, stackTraces: NodeJS.CallSite[]): any;
    stackTraceLimit: number;
};
