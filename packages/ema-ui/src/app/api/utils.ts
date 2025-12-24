import * as k from "arktype";

// https://dev.to/dzakh/zod-v4-17x-slower-and-why-you-should-care-1m1
// https://arktype.io/

/**
 * A middleware function to extract the body from the request and validate it against the schema.
 *
 * @param extractor - The extractor function to extract the body from the request.
 * @returns The API route function.
 */
const apiData =
  (extractor: (req: Request) => Promise<any>) =>
  <S>(schema: k.Type<S>) =>
  <F extends (body: S, req: Request) => Promise<Response>>(f: F) =>
  async (req: Request) => {
    const body = await extractor(req);
    const result = schema(body);
    if (result instanceof k.type.errors) {
      return new Response(JSON.stringify({ error: result.summary }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    return f(body, req);
  };

/**
 * A middleware function to extract the body from the request and validate it against the schema.
 *
 * @returns The API route function.
 */
export const postBody = apiData((req: Request) => req.json());

/**
 * A middleware function to extract the query parameters from the request and validate it against the schema.
 *
 * @returns The API route function.
 */
export const getQuery = apiData((req: Request) =>
  Promise.resolve(Object.fromEntries(new URL(req.url).searchParams.entries())),
);
