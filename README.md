# Products CRUD API

A products JSON CRUD API built with Node.js 18+ built-in modules. Data is stored in process memory and is cleared when the service restarts.

## Run

```bash
npm start
```

The service listens on `http://localhost:3000` by default. Set the `PORT` environment variable to use another port:

```bash
PORT=8080 npm start
```

## Tests

```bash
npm test
```

## API

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/health` | Health check |
| `GET` | `/products?limit=20&offset=0` | List products with pagination |
| `POST` | `/products` | Create a product |
| `GET` | `/products/:id` | Get one product |
| `PUT` | `/products/:id` | Replace a product |
| `PATCH` | `/products/:id` | Partially update a product |
| `DELETE` | `/products/:id` | Delete a product |

Create and `PUT` requests require `name` and `price`. Optional fields are `description`, `currency`, and `stock`; `currency` defaults to `USD` and `stock` defaults to `0`.

Example:

```bash
curl -X POST http://localhost:3000/products \
  -H 'content-type: application/json' \
  -d '{"name":"Keyboard","price":99.9,"stock":12}'
```
