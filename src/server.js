import { randomUUID } from "node:crypto";
import http from "node:http";

const DEFAULT_PORT = 3000;
const MAX_BODY_BYTES = 1024 * 1024;
const MAX_PAGE_SIZE = 100;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export class ProductStore {
  #products = new Map();

  list() {
    return [...this.#products.values()].sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    );
  }

  get(id) {
    return this.#products.get(id);
  }

  create(input) {
    const now = new Date().toISOString();
    const product = {
      id: randomUUID(),
      ...input,
      createdAt: now,
      updatedAt: now,
    };
    this.#products.set(product.id, product);
    return product;
  }

  update(id, input) {
    const existing = this.#products.get(id);
    if (!existing) {
      return undefined;
    }

    const product = {
      ...existing,
      ...input,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    };
    this.#products.set(id, product);
    return product;
  }

  delete(id) {
    return this.#products.delete(id);
  }
}

function sendJson(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  response.end(payload);
}

function sendError(response, error) {
  const body = {
    error: {
      code: error.code ?? "INTERNAL_ERROR",
      message: error.status ? error.message : "Internal server error",
    },
  };
  if (error.details) {
    body.error.details = error.details;
  }
  sendJson(response, error.status ?? 500, body);
}

function parseJsonBody(request) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];

    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new HttpError(413, "PAYLOAD_TOO_LARGE", "Request body is too large"));
        request.resume();
        return;
      }
      chunks.push(chunk);
    });

    request.on("end", () => {
      if (size === 0) {
        reject(new HttpError(400, "INVALID_JSON", "Request body must be valid JSON"));
        return;
      }

      try {
        const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (!value || Array.isArray(value) || typeof value !== "object") {
          throw new Error("JSON body must be an object");
        }
        resolve(value);
      } catch {
        reject(new HttpError(400, "INVALID_JSON", "Request body must be valid JSON"));
      }
    });

    request.on("error", () => {
      reject(new HttpError(400, "INVALID_REQUEST", "Unable to read request body"));
    });
  });
}

function validateProductInput(input, { partial = false } = {}) {
  const allowedFields = new Set(["name", "description", "price", "currency", "stock"]);
  const unknownFields = Object.keys(input).filter((key) => !allowedFields.has(key));
  if (unknownFields.length > 0) {
    throw new HttpError(400, "INVALID_PRODUCT", "Product contains unsupported fields", {
      fields: unknownFields,
    });
  }

  const requiredFields = partial ? [] : ["name", "price"];
  const missingFields = requiredFields.filter(
    (field) => input[field] === undefined,
  );
  if (missingFields.length > 0) {
    throw new HttpError(400, "INVALID_PRODUCT", "Product is missing required fields", {
      fields: missingFields,
    });
  }

  const product = {};
  if (input.name !== undefined) {
    if (typeof input.name !== "string" || input.name.trim().length === 0) {
      throw new HttpError(400, "INVALID_PRODUCT", "name must be a non-empty string");
    }
    if (input.name.length > 200) {
      throw new HttpError(400, "INVALID_PRODUCT", "name must be at most 200 characters");
    }
    product.name = input.name.trim();
  }

  if (input.description !== undefined) {
    if (typeof input.description !== "string" || input.description.length > 2000) {
      throw new HttpError(
        400,
        "INVALID_PRODUCT",
        "description must be a string of at most 2000 characters",
      );
    }
    product.description = input.description;
  }

  if (input.price !== undefined) {
    if (
      typeof input.price !== "number" ||
      !Number.isFinite(input.price) ||
      input.price < 0
    ) {
      throw new HttpError(400, "INVALID_PRODUCT", "price must be a finite non-negative number");
    }
    product.price = input.price;
  }

  if (input.currency !== undefined) {
    if (typeof input.currency !== "string" || !/^[A-Z]{3}$/.test(input.currency)) {
      throw new HttpError(400, "INVALID_PRODUCT", "currency must be a three-letter uppercase code");
    }
    product.currency = input.currency;
  } else if (!partial) {
    product.currency = "USD";
  }

  if (input.stock !== undefined) {
    if (
      !Number.isSafeInteger(input.stock) ||
      input.stock < 0 ||
      input.stock > 1_000_000_000
    ) {
      throw new HttpError(400, "INVALID_PRODUCT", "stock must be an integer from 0 to 1000000000");
    }
    product.stock = input.stock;
  } else if (!partial) {
    product.stock = 0;
  }

  return product;
}

function parsePagination(url) {
  const limitValue = url.searchParams.get("limit") ?? "20";
  const offsetValue = url.searchParams.get("offset") ?? "0";
  const limit = Number(limitValue);
  const offset = Number(offsetValue);
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > MAX_PAGE_SIZE ||
    !Number.isInteger(offset) ||
    offset < 0
  ) {
    throw new HttpError(
      400,
      "INVALID_PAGINATION",
      "limit must be 1-100 and offset must be a non-negative integer",
    );
  }
  return { limit, offset };
}

function getProductId(pathname) {
  const match = pathname.match(/^\/products\/([^/]+)$/);
  if (!match) {
    return undefined;
  }
  let id;
  try {
    id = decodeURIComponent(match[1]);
  } catch {
    throw new HttpError(400, "INVALID_ID", "Product ID is not valid");
  }
  if (!UUID_PATTERN.test(id)) {
    throw new HttpError(400, "INVALID_ID", "Product ID is not valid");
  }
  return id;
}

export function createApp({ store = new ProductStore() } = {}) {
  return async (request, response) => {
    try {
      const url = new URL(request.url, "http://localhost");
      const { method } = request;

      if (method === "GET" && url.pathname === "/health") {
        sendJson(response, 200, { status: "ok" });
        return;
      }

      if (url.pathname === "/products" && method === "GET") {
        const { limit, offset } = parsePagination(url);
        const products = store.list();
        sendJson(response, 200, {
          data: products.slice(offset, offset + limit),
          pagination: {
            limit,
            offset,
            total: products.length,
          },
        });
        return;
      }

      if (url.pathname === "/products" && method === "POST") {
        const product = store.create(validateProductInput(await parseJsonBody(request)));
        sendJson(response, 201, { data: product });
        return;
      }

      const id = getProductId(url.pathname);
      if (!id) {
        throw new HttpError(404, "NOT_FOUND", "Route not found");
      }

      if (method === "GET") {
        const product = store.get(id);
        if (!product) {
          throw new HttpError(404, "PRODUCT_NOT_FOUND", "Product not found");
        }
        sendJson(response, 200, { data: product });
        return;
      }

      if (method === "PUT" || method === "PATCH") {
        const product = store.update(
          id,
          validateProductInput(await parseJsonBody(request), {
            partial: method === "PATCH",
          }),
        );
        if (!product) {
          throw new HttpError(404, "PRODUCT_NOT_FOUND", "Product not found");
        }
        sendJson(response, 200, { data: product });
        return;
      }

      if (method === "DELETE") {
        if (!store.delete(id)) {
          throw new HttpError(404, "PRODUCT_NOT_FOUND", "Product not found");
        }
        response.writeHead(204);
        response.end();
        return;
      }

      throw new HttpError(405, "METHOD_NOT_ALLOWED", "Method not allowed");
    } catch (error) {
      sendError(response, error);
    }
  };
}

export function createServer(options) {
  return http.createServer(createApp(options));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT ?? DEFAULT_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }
  createServer().listen(port, () => {
    console.log(`Products API listening on http://localhost:${port}`);
  });
}
