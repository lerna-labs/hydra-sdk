import { requireEnv } from '@lerna-labs/hydra-sdk';
import type { NextFunction, Request, Response } from 'express';

const X_API_KEY = requireEnv('X_API_KEY');

export const authHeaderMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const required_auth_header = 'x-api-key';

  if (!req.headers[required_auth_header.toLowerCase()]) {
    console.log('Missing header');
    return res.status(404).send();
  }

  if (req.headers[required_auth_header.toLowerCase()] !== X_API_KEY) {
    console.log("Header doesn't match expected");
    return res.status(404).send();
  }

  next();
};
