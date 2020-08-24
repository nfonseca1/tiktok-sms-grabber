const puppeteer = require("puppeteer");
const express = require("express");
const app = express();
const session = require("express-session");

app.set("views", __dirname);
app.use(express.json());
app.use(express.urlencoded());
app.use(express.static(__dirname));
app.use(session({secret: "Shh, its a secret!"}));

app.get("/", (req, res) => {
	res.sendFile("./index.html");
	req.session.vidSources = [];
	req.session.save();
})

app.post("/", async (req, res) => {
	res.sendStatus(200);
	req.session.vidSources = await scrape(req);
	req.session.save();
})

app.get("/status", (req, res) => {
	req.session.reload(() => {
		res.send(req.session.vidSources);
	})
})

let scrape = async (req) => {
	const browser = await puppeteer.launch({headless: false, defaultViewport: {width: 1920, height: 1080}});
	const page = await browser.newPage();
	console.log(await page.browser().version());
	await page.goto("https://messages.google.com");

	await page.evaluate(() => {
		localStorage.setItem("dark_mode_enabled", "true");
		localStorage.setItem("pr_mw_exclusive_tab_key", "7a33c84e-4f08-86ad-ee64-f6d896986976");
		localStorage.setItem("pr_backend_type", "1");
		localStorage.setItem("pr_crypto_msg_enc_key", "GcYH6OtCHSCKVRI4OAou8r79yl8WV14XsMP9hRY3v20=");
		localStorage.setItem("pr_tachyon_auth_token", "ANcy13Fi/OhZKMJQFa6ih7bwD9PDGbo93wzAoAYcGC3Vxnm7pZN3CzCNhA4MQwiRxSlkpBp9AzHPhClS5Mas5qrnPPDniMEi2TpvgCckC9xNPIte2URa9ZldN1JF7hCFIHhHnCQSY6TmOC6b0SOcDw==");
		localStorage.setItem("pr_auth_sources", "B");
		localStorage.setItem("pr_crypto_msg_hmac", "jwu6io1nrBdCAWcoLxv1eY3y4xhgnPDmzO1ruOgm78U=");
		localStorage.setItem("pr_tachyon_auth_dest_id", "CA0SHCsxLVhuRXhkZnJwcGtPek1WaUVZYVVNVTliNTYaBUJ1Z2xl");
		localStorage.setItem("pr_tachyon_auth_desktop_id", "CA8SGSsxLWN4Z0h0a1pVWjNvTlFsQndQeGFneTkaBUJ1Z2xl");
		localStorage.setItem("pr_storage_state", "true");
		localStorage.setItem("pr_crypto_priv_key", "zb0rC2I8213iAPz10vPXm2T5FBfvqZ54uMWy7HYcJAo=");
		localStorage.setItem("pr_crypto_hmac", "La3/zUEEhZ4zZllFpz/kIrb3lHERrNab1JC8h7YfJfs=");
		localStorage.setItem("pr_crypto_pub_key", "BM7Sm1vKlCrhwbnPNBZ8/huG3/02ztOt/CAdDnuJ5zfSvkmKXK2XhGL+PEC98WCCNdEugJ++CI1Jlkk+5S8I53I=");

		sessionStorage.setItem("persist_history", "[true]");
		sessionStorage.setItem("latest_ditto_id", "+1-cxgHtkZUZ3oNQIBwPxagy9");

		let cookies = "_ga=GA1.3.1701660504.1598132763; pair_state_cookie=true; SID=0gdnNtnqhZZCMRiEFg_ktiScoFXisfPHSyEyNATejOxUTH-K_eLs_molmhiS0ZV_T0x5Zw.; APISID=kZ_4wqQ9tSGCFndc/A1LUQyrEydoZhe4jM; SAPISID=4PEr6cdpUJfHfY7h/AmQoq2feFqQ9egm5A; __Secure-3PAPISID=4PEr6cdpUJfHfY7h/AmQoq2feFqQ9egm5A; _gid=GA1.3.2134402985.1598227944; 1P_JAR=2020-08-24-00; SEARCH_SAMESITE=CgQIwpAB; SIDCC=AJi4QfFjE9gJ7QOzAxpvA81bU1RzPWGwrV614WDZgf0Dq4KSof-1psjVHQBE3-vXv_F_HKf_Ig";
		let cookiesArr = cookies.split("; ");
		cookiesArr.forEach((c) => {
			document.cookie = c;
		})
	})

	await page.goto("https://messages.google.com/web/conversations/2", {waitUntil: "networkidle2"});
	await page.waitForSelector("mws-message-wrapper");

	let links = await page.evaluate(async () => {
		return await new Promise(async (resolve, reject) => {
			let scroll = document.querySelector("mws-bottom-anchored");
			let scrollHeight = scroll.scrollHeight;
			scroll.scrollTo(0, 0);
			await new Promise((res, rej) => {
				let interval = setInterval(() => {
					if (scroll.scrollHeight > scrollHeight) {
						clearInterval(interval);
						res();
					}
				}, 50)
			})
			let aTags = document.querySelectorAll(".text-msg-content a");
			let aLinks = [];
			for (let a of aTags) {
				if (a.href.toLowerCase().includes("tiktok.com")){
					aLinks.push(a.href);
				}
			}
			resolve(aLinks);
		})
	})
	//console.log(links);	
	let videoSources = [];
	for (let link of links) {
		await page.goto(link, {waitUntil: "networkidle2"});
		let urls = await page.evaluate(async () => {
			return await new Promise(async (resolve, reject) => {
				let url = window.location.href;
				let targetURL = url.split("?")[0];
				let userURL = targetURL.split("/video")[0];
				resolve({target: targetURL, user: userURL})
			})
		})

		await page.goto(urls.user, {waitUntil: "networkidle2"});
		await page.waitForSelector(".video-feed-item");
		let vidSrc = await page.evaluate(async (target) => {
			return await new Promise(async (resolve, reject) => {
				let foundTarget = false;
				do {
					window.scrollTo(0, 1000000000);
					await new Promise((res, rej) => {
						setTimeout(() => res(), 100);
					})
					let aTags = document.querySelectorAll(".share-layout-main a");
					for (let a of aTags) {
						if (a.href == target) {
							foundTarget = true;
							a.click();
							await setTimeout(() => {
								resolve(document.querySelector("video").src);
							}, 100)
						}
					}
				}
				while(foundTarget === false);
			})
		}, urls.target)
		
		videoSources.push(vidSrc);
	}	
	browser.close();
	return videoSources;
}

app.listen(3000, () => {
	console.log("server started");
})