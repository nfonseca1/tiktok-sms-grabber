const puppeteer = require("puppeteer");
const express = require("express");
const app = express();
const session = require("express-session");

app.set("views", __dirname);
app.engine("html", require("ejs").__express);
app.use(express.json());
app.use(express.urlencoded());
//.app.use(express.static(__dirname));
app.use(session({secret: "Shh, its a secret!"}));

app.get("/", (req, res) => {
	req.session.content = {};
	req.session.content.posts = [];
	req.session.content.completed = false;
	req.session.save(() => {
		res.render("index.html");
	});
})

app.post("/", (req, res) => {
	res.sendStatus(200);
	req.session.reload(async () => {
		await scrape(req);
		req.session.content.completed = true;
		req.session.save();
	})
})

app.get("/status", (req, res) => {
	req.session.reload(() => {
		res.send(req.session.content);
	})
})

let scrape = async (req) => {
	const browser = await puppeteer.launch({headless: false, defaultViewport: {width: 4000, height: 1080}});
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
	// let posts = [];
	for (let link of links) {
		await page.goto(link, {waitUntil: "networkidle2"});
		let embedPost = await page.evaluate(async () => {
			return await new Promise(async (resolve, reject) => {
				let url = window.location.href;
				let targetURL = url.split("?")[0];
				let urlParts = targetURL.split("/video/");
				let userURL = urlParts[0];
				let user = userURL.split("tiktok.com/")[1];
				let id = urlParts[1];
				let embedHTML = `<blockquote class="tiktok-embed" cite="${targetURL}" 
					data-video-id="${id}" style="max-width: 605px;min-width: 325px;" > <section> <a target="_blank" 
					title="${user}" href="${userURL}"></a> </section> </blockquote>`;
				resolve({html: embedHTML, url: targetURL});
			})
		})
		req.session.reload(() => {
			req.session.content.posts.push(embedPost);
			req.session.save();
		})
	}	
	browser.close();
	return;
}

app.listen(3000, () => {
	console.log("server started");
})