const puppeteer = require("puppeteer");
const express = require("express");
const app = express();
const session = require("express-session");
const MongoClient = require("mongodb").MongoClient;
const bcrypt = require("bcrypt");
const saltRounds = 10;

require("dotenv").config();

let url = process.env.DB_HOST;

app.set("views", __dirname);
app.engine("html", require("ejs").__express);
app.use(express.json());
app.use(express.urlencoded());
app.use(express.static(__dirname));
app.use(session({secret: "Shh, its a secret!"}));

let browser;
let page;

app.get("/", (req, res) => {
	if (req.session.user) res.redirect("/home");
	else res.render("login.html");
})

app.post("/", async (req, res) => {
	let username = req.body.username;
	let password = req.body.password;

	MongoClient.connect(url, (err, client) => {
		if (err) throw err;
		let db = client.db("tiktok-sms-grabber");

		db.collection("Users").findOne({username: username}, async (err, result) => {
			if (err) throw err;
			if (result == null) {
				client.close();
				res.redirect("/");
				return;
			}

			let match = await bcrypt.compare(password, result.password);
			client.close();
			if (match) {
				req.session.user = result._id.toString();
				req.session.save();
				res.redirect("/home");
			}
		})
	})
})

app.post("/register", async (req, res) => {
	let username = req.body.username;
	let password = req.body.password;
	let hashedPass = await new Promise((resolve) => {
		bcrypt.hash(password, saltRounds, (err, hash) => {
			if (err) throw err;
			resolve(hash);
		});
	})

	await new Promise((resolve) => {
		MongoClient.connect(url, (err, client) => {
			if (err) throw err;
			let db = client.db("tiktok-sms-grabber");

			let newUser = {
				username: username,
				password: hashedPass
			}

			db.collection("Users").insertOne(newUser, (err, result) => {
				if (err) throw err;
				req.session.user = newUser._id.toString();
				req.session.save();
				console.log(newUser._id.toString());

				client.close();
				resolve();
			})
		})
	})	
	res.redirect("/home");
})

app.get("/home", (req, res) => {
	req.session.localData = {};
	req.session.content = {};
	req.session.content.posts = [];
	req.session.content.completed = false;
	req.session.save(() => {
		res.render("app.html");
	});
})

app.post("/home", (req, res) => {
	req.session.reload(async () => {
		browser = await puppeteer.launch({headless: false, defaultViewport: {width: 1920, height: 1080}});
		page = await browser.newPage();
		console.log(await page.browser().version());
		await page.goto("https://messages.google.com/web/authentication", {waitUntil: "networkidle2"});
		
		if (Object.keys(req.session.localData).length === 0) {
			await authenticate();
			res.send({authenticate: true});
			await getData(req);
		}
		else {
			res.send({authenticate: false});
			await setData(req);
		}
		await scrape(req, req.body.contact);
		req.session.content.completed = true;
		req.session.save();
	})
})

app.get("/status", (req, res) => {
	req.session.reload(() => {
		res.send(req.session.content);
	})
})

let authenticate = async() => {
	await page.screenshot({path: "./qr.png", clip: {x: 1075, y: 415, width: 250, height: 250}});
	await page.evaluate(() => {
		document.querySelector(".mat-slide-toggle-bar").click();
	})
	return;
}

let getData = async (req) => {
	await page.waitForSelector("mw-main-container");

	let dataObj = await page.evaluate(async () => {
		return await new Promise((res) => {
			let obj = {
				cookies: document.cookie,
				localStorage: JSON.stringify(window.localStorage),
				sessionStorage: JSON.stringify(window.sessionStorage)
			};
			res(obj);
		})
	})
	dataObj.localStorage = JSON.parse(dataObj.localStorage);
	dataObj.sessionStorage = JSON.parse(dataObj.sessionStorage);
	req.session.localData = dataObj;
	req.session.save();
}

let setData = async (req) => {
	await page.evaluate((local) => {
		localStorage.setItem("dark_mode_enabled", local.dark_mode_enabled);
		localStorage.setItem("pr_mw_exclusive_tab_key", local.pr_mw_exclusive_tab_key);
		localStorage.setItem("pr_backend_type", local.pr_backend_type);
		localStorage.setItem("pr_crypto_msg_enc_key", local.pr_crypto_msg_enc_key);
		localStorage.setItem("pr_tachyon_auth_token", local.pr_tachyon_auth_token);
		localStorage.setItem("pr_auth_sources", local.pr_auth_sources);
		localStorage.setItem("pr_crypto_msg_hmac", local.pr_crypto_msg_hmac);
		localStorage.setItem("pr_tachyon_auth_dest_id", local.pr_tachyon_auth_dest_id);
		localStorage.setItem("pr_tachyon_auth_desktop_id", local.pr_tachyon_auth_desktop_id);
		localStorage.setItem("pr_storage_state", local.pr_storage_state);
		localStorage.setItem("pr_crypto_priv_key", local.pr_crypto_priv_key);
		localStorage.setItem("pr_crypto_hmac", local.pr_crypto_hmac);
		localStorage.setItem("pr_crypto_pub_key", local.pr_crypto_pub_key);
	}, req.session.localData.localStorage)

	await page.evaluate((session) => {
		sessionStorage.setItem("persist_history", session.persist_history);
		sessionStorage.setItem("latest_ditto_id", session.latest_ditto_id);
	}, req.session.localData.sessionStorage)

	await page.evaluate((cookies) => {
		let cookiesArr = cookies.split("; ");
		cookiesArr.forEach((c) => {
			document.cookie = c;
		})
	}, req.session.localData.cookies)
}

let scrape = async (req, contact) => {
	//await req.session.reload();

	await page.evaluate((contact) => {
		let conversations = document.querySelectorAll("mws-conversation-list-item a span");
		for (let span of conversations) {
			if (span.textContent.toLowerCase() === contact.toLowerCase()) span.click();
		}
	}, contact)

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