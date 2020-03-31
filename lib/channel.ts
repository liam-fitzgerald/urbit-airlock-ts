import { request, Config } from "./util";
import EventSource from "eventsource";
import { Marks, Mark, Cage } from "./marks";
import { UrbitConnection } from "./setup";

interface OutstandingPoke {
  onSuccess: () => void;
  onFailure: (e: any) => void;
}

interface SubscriptionEventSource {
  application: string;
  ship: string;
}

type SubscriptionEvent<M extends Mark> = SubscriptionEventSource & Cage<M>;

export interface OutstandingSubscription<M extends Mark> {
  mark: M;
  onError: (err: any) => void;
  onEvent: (event: Cage<M>) => void;
  onQuit: (err: any) => void;
}

/**
 * A Channel is an HTTP connection to a running Urbit. Using it, you can poke and subscribe to agents
 */
export class Channel {
  /**
   * unique identifier: current time and random number
   */

  private uid: string =
    new Date().getTime().toString() +
    "-" +
    Math.random()
      .toString(16)
      .slice(-6);
  /**
   * The ID of the last request we sent to the server
   */
  private requestId: number = 1;

  /**
   * The EventSource that we are receiving messages on,
   * or null if we've not connected yet.
   */
  private eventSource: EventSource | null = null;

  /**
   * The id of the last EventSource event we received
   */
  private lastEventId: number = 0;

  /**
   * The id of the last event we acked to the server
   */
  private lastAcknowledgedEventId: number = 0;

  /**
   * A map of requestId to handlers
   *
   *    These functions are registered during a +poke and are executed
   *    in the onServerEvent()/onServerError() callbacks. Only one of
   *    the functions will be called, and the outstanding poke will be
   *    removed after calling the success or failure function.
   */
  private outstandingPokes: Map<number, OutstandingPoke> = new Map();

  /**
   * A map of requestId to subscription handlers.
   *
   *    These functions are registered during a +subscribe and are
   *    executed in the onServerEvent()/onServerError() callbacks. The
   *    event function will be called whenever a new piece of data on this
   *    subscription is available, which may be 0, 1, or many times. The
   *    disconnect function may be called exactly once.
   */
  private outstandingSubscriptions: Map<
    number,
    OutstandingSubscription<Mark>
  > = new Map();

  /**
   * @param conn Object describing connection to urbit
   */
  constructor(private conn: UrbitConnection) {}

  /**
   * Poke a Gall agent with a cage.
   * @param app name of Gall agent to send poke to
   * @param cage The cage to poke the agent with
   * @returns A promise that resolves when the poke is successfully
   * executed and rejects when the poke errors
   */
  poke<M extends Mark>(app: string, cage: Cage<M>): Promise<void> {
    let id = this.nextId();
    return new Promise((resolve, reject) => {
      this.outstandingPokes.set(id, { onSuccess: resolve, onFailure: reject });

      this.sendJSONToChannel({
        id,
        action: "poke",
        ship: this.conn.ship,
        app,
        mark: cage.mark,
        json: cage.data
      });
    });
  }

  /**
   * Subscribe to a Gall agent on a path, executing handlers on each event or on subscription quit or subscription error.
   * See also: [[unsubscribe]]
   *
   * @param app name of Gall agent to subscribe to
   * @param path path to subscribe on
   * @param handlers event handlers for the subscription
   * @returns a subscription id, which can be used to cancel the subscription
   */
  subscribe<M extends Mark>(
    app: string,
    path: string,
    handlers: OutstandingSubscription<M>
  ): number {
    let id = this.nextId();
    this.outstandingSubscriptions.set(id, handlers);

    this.sendJSONToChannel({
      id,
      action: "subscribe",
      ship: this.conn.ship,
      app,
      path
    });

    return id;
  }

  /**
   * Cancel a subscription to a gall agent
   *
   * @param subscription the ID returned from [[subscribe]]
   */
  unsubscribe(subscription: number) {
    let id = this.nextId();
    this.sendJSONToChannel({
      id,
      action: "unsubscribe",
      subscription
    });
  }

  //  sends a JSON command command to the server.
  //
  private sendJSONToChannel(j: unknown) {
    let body: any;
    if (this.lastEventId == this.lastAcknowledgedEventId) {
      body = JSON.stringify([j]);
    } else {
      //  we add an acknowledgment to clear the server side queue
      //
      //    The server side puts messages it sends us in a queue until we
      //    acknowledge that we received it.
      //
      body = JSON.stringify([
        { action: "ack", "event-id": this.lastEventId },
        j
      ]);

      this.lastEventId = this.lastAcknowledgedEventId;
    }
    return request(
      this.channelURL(),
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": body.length,
          Cookie: this.conn.cookies
        },
        port: this.conn.port
      },
      body
    ).then(r => {
      return this.connectIfDisconnected();
    });
  }

  //  connects to the EventSource if we are not currently connected
  //
  private connectIfDisconnected() {
    if (this.eventSource) {
      return;
    }

    const eventSource = new EventSource(this.channelURL(), {
      headers: { Cookie: this.conn.cookies, Connection: "keep-alive" },
      withCredentials: true
    });
    eventSource.onmessage = (e: MessageEvent) => {
      this.lastEventId = parseInt(e.lastEventId, 10);

      let obj = JSON.parse(e.data);
      if (obj.response == "poke") {
        let funcs = this.outstandingPokes.get(obj.id);
        if (obj.hasOwnProperty("ok")) {
          funcs.onSuccess();
        } else if (obj.hasOwnProperty("err") && funcs) {
          funcs.onFailure(obj.err);
        }
        this.outstandingPokes.delete(obj.id);
      } else if (obj.response == "subscribe") {
        //  on a response to a subscribe, we only notify the caller on err
        //
        let funcs = this.outstandingSubscriptions.get(obj.id);
        if (obj.hasOwnProperty("err")) {
          funcs.onError(obj.err);
          this.outstandingSubscriptions.delete(obj.id);
        }
      } else if (obj.response == "diff") {
        let funcs = this.outstandingSubscriptions.get(obj.id);
        funcs.onEvent(obj.json);
      } else if (obj.response == "quit") {
        let funcs = this.outstandingSubscriptions.get(obj.id);
        funcs.onQuit(obj);
        this.outstandingSubscriptions.delete(obj.id);
      } else {
      }
    };

    eventSource.onerror = e => {};
    this.eventSource = eventSource;
  }

  private channelURL() {
    const result =
      this.conn.url + ":" + this.conn.port + "/~/channel/" + this.uid;
    return result;
  }

  private nextId() {
    return this.requestId++;
  }
}
