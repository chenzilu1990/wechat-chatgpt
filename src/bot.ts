import { ChatGPTPool } from "./chatgpt.js";
import { config } from "./config.js";
import { ContactInterface, RoomInterface } from "wechaty/impls";
import { Message } from "wechaty";
enum MessageType {
  Unknown = 0,

  Attachment = 1, // Attach(6),
  Audio = 2, // Audio(1), Voice(34)
  Contact = 3, // ShareCard(42)
  ChatHistory = 4, // ChatHistory(19)
  Emoticon = 5, // Sticker: Emoticon(15), Emoticon(47)
  Image = 6, // Img(2), Image(3)
  Text = 7, // Text(1)
  Location = 8, // Location(48)
  MiniProgram = 9, // MiniProgram(33)
  GroupNote = 10, // GroupNote(53)
  Transfer = 11, // Transfers(2000)
  RedEnvelope = 12, // RedEnvelopes(2001)
  Recalled = 13, // Recalled(10002)
  Url = 14, // Url(5)
  Video = 15, // Video(4), Video(43)
  Post = 16, // Moment, Channel, Tweet, etc
}

type Asker = {
  room_id: string,
  askTime: number
}

type ItemWithTimer<T> = {
  item: T;
  timerId: ReturnType<typeof setTimeout>;
};

function addItemWithTimer<T>(
  array: ItemWithTimer<T>[],
  item: T,
  timeout: number,
  onTimeout?: (item: T) => void
): void {
  const timerId = setTimeout(() => {
    const index = array.findIndex((el) => el.timerId === timerId);
    if (index !== -1) {
      const { item } = array[index];
      array.splice(index, 1);
      onTimeout?.(item);
    }
  }, timeout);
  array.push({ item, timerId });
}

const askers: Asker[] = []
const askerWithTimers: ItemWithTimer<Asker>[] = [];
const SINGLE_MESSAGE_MAX_SIZE = 500;
export class ChatGPTBot {
  // Record talkid with conversation id
  chatGPTPool = new ChatGPTPool();
  chatPrivateTiggerKeyword = config.chatPrivateTiggerKeyword;
  chatTiggerRule = config.chatTiggerRule? new RegExp(config.chatTiggerRule): undefined;
  botName: string = "";
  ready = false;
  setBotName(botName: string) {
    this.botName = botName;
  }
  get chatGroupTiggerRegEx(): RegExp {
    return new RegExp(`^@${this.botName}\\s`);
  }
  get chatPrivateTiggerRule(): RegExp | undefined {
    const { chatPrivateTiggerKeyword, chatTiggerRule } = this;
    let regEx = chatTiggerRule
    if (!regEx && chatPrivateTiggerKeyword) {
      regEx = new RegExp(chatPrivateTiggerKeyword)
    }
    return regEx
  }
  async startGPTBot() {
    console.debug(`Start GPT Bot Config is:${JSON.stringify(config)}`);
    await this.chatGPTPool.startPools();
    console.debug(`🤖️ Start GPT Bot Success, ready to handle message!`);
    this.ready = true;
  }
  // TODO: Add reset conversation id and ping pong
  async command(): Promise<void> {}
  // remove more times conversation and mention
  cleanMessage(rawText: string, privateChat: boolean = false): string {
    let text = rawText;
    const item = rawText.split("- - - - - - - - - - - - - - -");
    if (item.length > 1) {
      text = item[item.length - 1];
    }
    
    const { chatTiggerRule, chatPrivateTiggerRule } = this;
    
    if (privateChat && chatPrivateTiggerRule) {
      text = text.replace(chatPrivateTiggerRule, "")
    } else if (!privateChat) {
      text = text.replace(this.chatGroupTiggerRegEx, "")
      text = chatTiggerRule? text.replace(chatTiggerRule, ""): text
    }
    // remove more text via - - - - - - - - - - - - - - -
    return text
  }
  async getGPTMessage(text: string, talkerId: string): Promise<string> {
    return await this.chatGPTPool.sendMessage(text, talkerId);
  }
  // The message is segmented according to its size
  async trySay(
    talker: RoomInterface | ContactInterface,
    mesasge: string
  ): Promise<void> {
    const messages: Array<string> = [];
    let message = mesasge;
    while (message.length > SINGLE_MESSAGE_MAX_SIZE) {
      messages.push(message.slice(0, SINGLE_MESSAGE_MAX_SIZE));
      message = message.slice(SINGLE_MESSAGE_MAX_SIZE);
    }
    messages.push(message);
    for (const msg of messages) {
      await talker.say(msg);
    }
  }
  // Check whether the ChatGPT processing can be triggered
  tiggerGPTMessage(text: string, privateChat: boolean = false): boolean {
    const { chatTiggerRule } = this;
    let triggered = false;
    if (privateChat) {
      const regEx = this.chatPrivateTiggerRule
      triggered = regEx? regEx.test(text): true;
    } else {
      triggered = this.chatGroupTiggerRegEx.test(text);
      // group message support `chatTiggerRule`
      if (triggered && chatTiggerRule) {
        triggered = chatTiggerRule.test(text.replace(this.chatGroupTiggerRegEx, ""))
      }
    }
    if (triggered) {
      console.log(`🎯 Triggered ChatGPT: ${text}`);
    }
    return triggered;
  }
  // Filter out the message that does not need to be processed
  isNonsense(
    talker: ContactInterface,
    messageType: MessageType,
    text: string
  ): boolean {
    return (
      talker.self() ||
      // TODO: add doc support
      messageType !== MessageType.Text ||
      talker.name() === "微信团队" ||
      // 语音(视频)消息
      text.includes("收到一条视频/语音聊天消息，请在手机上查看") ||
      // 红包消息
      text.includes("收到红包，请在手机上查看") ||
      // Transfer message
      text.includes("收到转账，请在手机上查看") ||
      // 位置消息
      text.includes("/cgi-bin/mmwebwx-bin/webwxgetpubliclinkimg")
    );
  }

  async onPrivateMessage(talker: ContactInterface, text: string) {
    const talkerId = talker.id;
    const gptMessage = await this.getGPTMessage(text, talkerId);
    await this.trySay(talker, gptMessage);
  }

  async onGroupMessage(
    talker: ContactInterface,
    text: string,
    room: RoomInterface
  ) {
    const talkerId = room.id + talker.id;
    await this.trySay(room, `${text}\n ------\n ${"稍等"}`);
    const gptMessage = await this.getGPTMessage(text, talkerId);
    const result = `${text}\n ------\n ${gptMessage}`;
    await this.trySay(room, result);
  }
  async onMessage(message: Message) {
    const talker = message.talker();
    const rawText = message.text();
    const room = message.room();
    const messageType = message.type();
    const privateChat = !room;
    const askTime = message.date().getTime()

    const timeOut = 2 * 60 * 1000


    const askerWithTimer = askerWithTimers.find((askerWithTimer) => askerWithTimer.item.room_id === room?.id + "_" + talker.id);
    if (!!room && askerWithTimer) {

      const text = this.cleanMessage(rawText, privateChat);
      askerWithTimer.item.askTime = askTime
      return await this.onGroupMessage(talker, text, room);

    }

    if (this.isNonsense(talker, messageType, rawText)) {
      return;
    }
    if (this.tiggerGPTMessage(rawText, privateChat)) {
      const text = this.cleanMessage(rawText, privateChat);
      if (privateChat) {
        return await this.onPrivateMessage(talker, text);
      } else {
        const asker: Asker = {
          room_id: room.id + "_" + talker.id,
          askTime: askTime
        }
        addItemWithTimer(askerWithTimers, asker, timeOut)
        
        return await this.onGroupMessage(talker, text, room);
      }
    } else {
      return;
    }
  }
}
