import { WechatyBuilder } from "wechaty";
import QRCode from "qrcode";
import { ChatGPTBot } from "./bot.js";
const chatGPTBot = new ChatGPTBot();

const bot =  WechatyBuilder.build({
  name: "wechat-assistant", // generate xxxx.memory-card.json and save login data for the next login
  puppetOptions: {
    uos: true, // 开启uos协议
  },
  puppet: "wechaty-puppet-wechat",
});
// get a Wechaty instance

async function main() {
  const initializedAt = Date.now()
  await chatGPTBot.startGPTBot();
  bot
    .on("scan", async (qrcode, status) => {
      const url = `https://wechaty.js.org/qrcode/${encodeURIComponent(qrcode)}`;
      console.log(`Scan QR Code to login: ${status}\n${url}`);
      console.log(
        await QRCode.toString(qrcode, { type: "terminal", small: true })
      );
    })
    .on("login", async (user) => {
      console.log(`User ${user} logged in`);
      chatGPTBot.setBotName(user.name());
    })
    .on("message", async (message) => {
      if (
        !chatGPTBot.ready || 
        message.date().getTime() < initializedAt
      ) {
        return;
      }
      if (message.text().startsWith("/ping")) {
        await message.say("pong");
        return;
      }
      if (message.text().startsWith("滚蛋")) {
        const talkerID = message.talker().id
        const index = chatGPTBot.stopIds.findIndex((id) => id === talkerID)
        if ( index !== -1) {
          await message.say("我已经滚到天边了");
        } else {
          chatGPTBot.stopIds.push(message.talker().id)
          await message.say("我最会滚蛋了，这就滚");
        }
        return;
      }

      if (message.text().startsWith("回来")) {
        const talkerID = message.talker().id
        const index = chatGPTBot.stopIds.findIndex((id) => id === talkerID)
        if (index !== -1) {
          chatGPTBot.stopIds.splice(index)
          await message.say("我又回来了,现在你可以问我问题了");
        } else {
          await message.say("我在,你可以问我问题了");
        }
        return;
      }

      if (message.text().startsWith("天王盖地虎")) {
        await message.say("宝塔镇河妖");
        return;
      }


      try {
        console.log(`Message: ${message}`);
        await chatGPTBot.onMessage(message);
      } catch (e) {
        console.error(e);
      }
    });
  try {
    await bot.start();
  } catch (e) {
    console.error(
      `⚠️ Bot start failed, can you log in through wechat on the web?: ${e}`
    );
  }
}
main();
