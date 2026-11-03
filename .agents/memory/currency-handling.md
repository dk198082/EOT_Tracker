---
name: Currency handling
description: How ETO monetary values carry their currencies.
---

All ETO money amounts use a dedicated currency field alongside the existing text amount. Accepted currencies are USD, GBP, EUR, and CNY; default to USD in the database, API, and interface.

**Why:** Amounts were historically stored as free-form text, so putting a symbol in the amount is ambiguous and makes international quoting error-prone. Separate currency codes preserve existing values while making their denomination explicit.

**How to apply:** Any future monetary field must add a paired currency field, use the same four choices, and use USD as its default. Never infer currency from a typed symbol in an existing amount.