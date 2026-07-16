# README

https://github.com/if001/knowledge-access

https://github.com/if001/simple-pomdp-system

https://github.com/if001/chat-memory-system

https://github.com/if001/chat-relationship-system

## migrate

``` shell
npm run db:generate

npm run db:migrate
```

## test
``` shell
RUN_WEB_BACKEND_TESTS=1 SIMPLE_CLIENT_BASE_URL=http://172.22.1.15:8000 npm test
```

``` shell
RUN_DB_INTEGRATION_TESTS=1 POSTGRES_URL=postgresql+psycopg://app_user:app_pw@172.22.1.15:5431/appdb npm test src/infrastructure/db/postgres.integration.test.ts
```
