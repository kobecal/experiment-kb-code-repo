import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createServer } from "../src/server.js";

let server;
let baseUrl;

before(async () => {
  server = createServer();
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

async function request(path, options) {
  return fetch(`${baseUrl}${path}`, {
    headers: { "content-type": "application/json" },
    ...options,
  });
}

describe("products API", () => {
  it("creates and reads a product", async () => {
    const createResponse = await request("/products", {
      method: "POST",
      body: JSON.stringify({
        name: "Keyboard",
        description: "A mechanical keyboard",
        price: 99.9,
        stock: 12,
      }),
    });
    assert.equal(createResponse.status, 201);
    const created = (await createResponse.json()).data;
    assert.match(created.id, /^[0-9a-f-]{36}$/);
    assert.equal(created.currency, "USD");
    assert.equal(created.stock, 12);

    const getResponse = await request(`/products/${created.id}`);
    assert.equal(getResponse.status, 200);
    assert.deepEqual((await getResponse.json()).data, created);
  });

  it("lists products with pagination", async () => {
    const response = await request("/products?limit=1&offset=0");
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.data.length, 1);
    assert.equal(body.pagination.limit, 1);
    assert.equal(body.pagination.total, 1);
  });

  it("updates and deletes a product", async () => {
    const createResponse = await request("/products", {
      method: "POST",
      body: JSON.stringify({ name: "Mouse", price: 25 }),
    });
    const id = (await createResponse.json()).data.id;

    const updateResponse = await request(`/products/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ stock: 5 }),
    });
    assert.equal(updateResponse.status, 200);
    assert.equal((await updateResponse.json()).data.stock, 5);

    const deleteResponse = await request(`/products/${id}`, {
      method: "DELETE",
    });
    assert.equal(deleteResponse.status, 204);

    const getResponse = await request(`/products/${id}`);
    assert.equal(getResponse.status, 404);
  });

  it("rejects invalid product input", async () => {
    const response = await request("/products", {
      method: "POST",
      body: JSON.stringify({ name: "", price: -1 }),
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, "INVALID_PRODUCT");
  });
});
