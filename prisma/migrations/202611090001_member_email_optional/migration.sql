-- E-mail dos membros e opcional; a restricao UNIQUE continua garantindo unicidade quando informado.
ALTER TABLE "Member" ALTER COLUMN "email" DROP NOT NULL;
