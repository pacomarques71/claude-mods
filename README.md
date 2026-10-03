# claude-mods

Mis mods de Claude Code, como marketplace de plugins.

## Instalar en un PC (una sola vez)

```
claude plugin marketplace add <usuario>/claude-mods
claude plugin install usage-band@pacom-mods
```

## Añadir un mod nuevo

1. Crea `plugins/<nombre>/` con `.claude-plugin/plugin.json` y `hooks/`.
2. Añádelo a la lista `plugins` de `.claude-plugin/marketplace.json`.
3. Haz commit y push. En cada PC: `claude plugin marketplace update pacom-mods`
   (o deja que se actualice solo al arrancar) y `claude plugin install <nombre>@pacom-mods`.
