# Regras do Firebase Storage para fotos de Defesa/Contestação

Para que as fotos sejam enviadas e lidas corretamente, é necessário atualizar as regras do Firebase Storage no Console do Firebase.

## Regras recomendadas

Substitua o conteúdo atual em **Firebase Console → Storage → Rules** por:

```
rules_version = '2';

service firebase.storage {
  match /b/{bucket}/o {
    // Fotos de contestação Defesa - leitura e escrita liberadas para a pasta defesa/
    match /defesa/{allPaths=**} {
      allow read, write: if true;
    }
    // Bloqueia o restante
    match /{allPaths=**} {
      allow read, write: if false;
    }
  }
}
```

**Nota:** `allow read, write: if true` na pasta `defesa/` permite que qualquer pessoa com a URL acesse as imagens. Para produção com autenticação, use `allow read, write: if request.auth != null` (requer Firebase Auth configurado).

## Estrutura dos arquivos no Storage

```
defesa/
  {bfsId}/
    agente_sub_0.jpg
    agente_sub_1.jpg
    rastreamento_0.jpg
    nosso_agente_0.jpg
    nosso_agente_1.jpg
```
