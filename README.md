# Urbit Airlock bindings

## Installation

`npm install urbit-airlock --save`

## Usage

### Connection

Opening a connection to your urbit is as follows

``` typescript
const connection = await connect(
  'zod',
  'http://localhost',
  80,
  'lidlut-tabwed-pillex-ridrup'
);
const channel = new Channel(connection);

```

You may then subscribe and poke over the connection.

```typescript


channel.subscribe('chat-view', '/primary', {
  mark: 'json',
  onError: (err: any) => { console.log(err); },
  onEvent: (event: any) => { console.log(event); },
  onQuit: (err: any) => { console.log(err); }
});

channel.poke('gall-app', {
  mark: 'json',
  data: { update: 2 }
});
```

### Typescript

Pokes and subscription updates are strongly typed, but you need to make the
interface-mark correspondence known to typescript.

You associate a mark to an interface like so

``` typescript
declare module 'urbit-airlock/lib/marks' {
  interface Marks {
    readonly 'number': number;
  }
}
```

This associates the 'number' mark to the typescript type `number`

