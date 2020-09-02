const puppeteer = require("puppeteer");
const express = require("express");
const app = express();
const session = require("express-session");
const MongoClient = require("mongodb").MongoClient;
const bcrypt = require("bcrypt"); // Encryption
const saltRounds = 10; // Required for encryption

require("dotenv").config(); // Environment variables

let url = process.env.DB_HOST; // Database url

app.set("views", __dirname);
app.engine("html", require("ejs").__express);
app.use(express.json());
app.use(express.urlencoded());
app.use(express.static(__dirname)); // For static files such as css
app.use(session({secret: "Shh, its a secret!"})); // For user session

// login page
app.get("/", (req, res) => {
    // If user has a session, redirect to home. Otherwise render login page
	if (req.session.user) res.redirect("/home");
	else res.render("login.ejs", {loginError: "", regError: ""});
})

// Handle login request
app.post("/login", (req, res) => {
    let username = req.body.username;
	let password = req.body.password;
    // Connect to mongodb
	MongoClient.connect(url, (err, client) => {
		if (err) throw err;
		let db = client.db("tiktok-sms-grabber");
        // Find user with submitted username
		db.collection("Users").findOne({username: username}, async (err, result) => {
            client.close();
			if (err) throw err;
			if (result == null) {
				res.render("login.ejs", {loginError: "Username/password did not match", regError: ""});
				return;
			}
            // Compare submitted password with encrypted db password
			let match = await bcrypt.compare(password, result.password);
			if (match) {
                // Set user session properties if matched
                req.session.user = {
                    id: result._id.toString(),
                    username: result.username,
                    contacts: result.contacts
                }
                req.session.save();
                // Set up session data properties
                req.session.localData = {};
                req.session.content = {
                    finishedLoading: true,
                    contact: null,
                    posts: []
                }
				res.redirect("/home"); // Go to home route
            }
            else {
                res.render("login.ejs", {loginError: "Username/password did not match", regError: ""});
                return;
            }
		})
	})
})

// Handle new user registration
app.post("/register", (req, res) => {
    let username = req.body.username;
    let password = req.body.password;
    // Connect to mongodb
    MongoClient.connect(url, (err, client) => {
        if (err) throw err;
        let db = client.db("tiktok-sms-grabber");
        // Find user with submitted username
        db.collection("Users").findOne({username: username}, async (err, result) => {
            if (err) throw err;
            if (result) {
                // If user exists, re-render login with registration error
                client.close();
                res.render("login.ejs", {loginError: "", regError: "Username already exists"});
            }
            else {
                // Encrypt password to save to database
                let hashedPass = await new Promise((resolve) => {
                    bcrypt.hash(password, saltRounds, (err, hash) => {
                        if (err) throw err;
                        resolve(hash);
                    });
                })
                // Set user to be added
                let newUser = {
                    username: username,
                    password: hashedPass,
                    contacts: []
                }
                // Insert new user to database
                db.collection("Users").insertOne(newUser, (err) => {
                    client.close();
                    if (err) throw err;
                    // Add new user to session
                    req.session.user = {
                        id: newUser._id.toString(),
                        username: newUser.username,
                        contacts: newUser.contacts
                    }
                    req.session.save();
                    res.redirect("/home"); // Go to home route
                })
            }
        })
    })
})

// Home page for user
app.get("/home", (req, res) => {
    if (!req.session.user) {
        res.redirect("/");
        return;
    }
    res.render("home.ejs", {contacts: req.session.user.contacts}); // Render home page
})

// Add new contact for user
app.post("/contacts", (req, res) => {
    let contact = req.body.contact;
    let username = req.body.username;

    // Connect to mongodb
    MongoClient.connect(url, (err, client) => {
        if (err) throw err;
        let db = client.db("tiktok-sms-grabber");
        // Set new contact to be added to db
        let newContact = {
            contactName: contact,
            username: username
        }
        let currentUser = req.session.user.username;
        db.collection("Users").updateOne({username: currentUser}, { $push: { contacts: newContact }}, (err, result) => {
            if (err) throw err;
            // Update user contacts in session data
            req.session.user.contacts.push(newContact);
            req.session.save(() => {
                // Re-render home page with new contacts
                res.send(newContact);
            });
        })
    })
})

// Retrieve posts for user
app.get("/posts", (req, res) => {
    req.session.content.finishedLoading = false;
    let contact = req.query.contactUsername;
    req.session.content.contact = contact;
    // Connect to mongodb to check for posts
    MongoClient.connect(url, (err, client) => {
        if (err) throw err;
        let db = client.db("tiktok-sms-grabber");
        let currentUser = req.session.user.username;
        db.collection("Posts", (err, collection) => {
            collection.find({users: { $all: [{username: contact}, {username: currentUser}]}}, (err, result) => {
                if (err) throw err;
                req.session.content.finishedLoading = true;
                req.session.content.posts = [];
                // Send results
                collection.find().toArray(async (err, docs) => {
                    if (docs.length > 0) {
                        for (let doc of docs) {
                            let yourRating = 0;
                            let theirRating = 0;
                            if (doc.users[0].username === currentUser) {
                                yourRating = doc.users[0].rating;
                                theirRating = doc.users[1].rating;
                            }
                            else {
                                yourRating = doc.users[1].rating;
                                theirRating = doc.users[0].rating;
                            }
                            let comments = await new Promise((resolve) => {
                                db.collection("Comments").find({postId: doc._id.toString()}).toArray((err, commentResults) => {
                                    resolve(commentResults);
                                })
                            })
                            let obj = {
                                id: doc._id.toString(),
                                html: doc.html,
                                yourRating: yourRating,
                                theirRating: theirRating,
                                comments: comments || [],
                                link: doc.link,
                                date: doc.date
                            }
                            req.session.content.posts.push(obj);
                        }
                        res.send({results: req.session.content, user: req.session.user})
                    }
                    else {
                        res.send({results: null});
                    }
                })
            })
        })
    })
})

// Scan messages for new posts
app.post("/posts", async (req, res) => {
    req.session.content.finishedLoading = false;
    let contactNames = req.body.contact.split("-");
    let contact = contactNames[0];
    let contactUsername = contactNames[1];
    // Launch puppeteer
    let browser = await puppeteer.launch({headless: true, defaultViewport: {width: 1920, height: 1080}})
    let page = await browser.newPage();
    await page.goto("https://messages.google.com/web/authentication", {waitUntil: "networkidle2"});
    
    // Check for local data in session
    if (Object.keys(req.session.localData).length === 0) {
        await authenticate(page);
        res.send({authenticate: true});
        // Wait for page to redirect to messages
        let selectorFound = page.waitForSelector("mw-main-container");
        selectorFound.then(async () => {
            let dataObj = await getLocalData(page, req);
            // Save data into session for future use
            req.session.localData = dataObj;
            req.session.save();
            // Scrape message conversation for posts and then finish
            await scrape(page, req, contact, contactUsername);
            browser.close();
            req.session.content.finishedLoading = true;
        })
        .catch(() => { // If browser times out while waiting, close and finish
            browser.close();
            // TODO: convert finished loading to a status property to check specific status
            req.session.content.finishedLoading = true;
            return;
        })
    }
    else {
        res.send({authenticate: false});
        await setData(page, req);
        // Reload page after setting data and wait for list of contacts to load
        await page.goto("https://messages.google.com/web/authentication", {waitUntil: "networkidle2"});
        try {
            let selectorFound = page.waitForSelector("mw-main-container");
            selectorFound.then(async () => {
                await scrape(page, req, contact, contactUsername);
                browser.close();
                req.session.content.finishedLoading = true;
            })
        }
        catch(e) { // If browser times out while waiting, close, reset data and finish
            browser.close();
            req.session.content.finishedLoading = true;
            req.session.localData = {};
            return;
        }
    }
})

// Check post retrieval status
app.get("/status", (req, res) => {
    req.session.reload(() => {
        res.send(req.session.content);
    })
})

// Add new post comment
app.post("/comments", (req, res) => {
    let postId = req.body.postId;
    let commentText = req.body.commentText;
    MongoClient.connect(url, (err, client) => {
        if (err) throw err;
        let db = client.db("tiktok-sms-grabber");
        let obj = {
            postId: postId,
            text: commentText,
            author: req.session.user.username,
            date: Date.now()
        }
        db.collection("Comments").insertOne(obj, (err) => {
            if (err) throw err;
            client.close();
            // TODO: change content post array to an object with the id as key
            for (let post of req.session.content.posts) {
                if (post.id === postId) {
                    post.comments.push(obj);
                    res.send({success: true});
                    return;
                }
            }
        })
    })
})

// Take screenshot of qr code to send to user for authentication
let authenticate = async(page) => {
	await page.screenshot({path: "./qr.png", clip: {x: 1075, y: 415, width: 250, height: 250}});
	await page.evaluate(() => {
        // Click on slider to stay logged in
		document.querySelector(".mat-slide-toggle-bar").click();
	})
	return;
}

// Get cookiess, localStorage and sessionStorage to put into session
let getLocalData = async (page) => {
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
    return dataObj;
}

// Set cookies, local storage and session storage for website
let setData = async (page, req) => {
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

// Scrape messages for new tiktok posts
let scrape = async (page, req, contact, contactUsername) => {
    // Wait for contacts to actually load on page
    await page.waitForSelector("mws-conversation-list-item");
    // TODO: handle timeout

    // Click on specified contact
	await page.evaluate((contact) => {
		let conversations = document.querySelectorAll("mws-conversation-list-item a span");
		for (let span of conversations) {
			if (span.textContent.toLowerCase() === contact.toLowerCase()) span.click();
		}
	}, contact)

	// Wait for messages to load
    await page.waitForSelector("mws-message-wrapper");
    // TODO: handle timeout

    // Search for tiktok links in conversation
	let links = await page.evaluate(async (posts) => {
		return await new Promise(async (resolve, reject) => {
			await new Promise((resolve) => {
                // Get scrollable div containing messages
                let scroll = document.querySelector("mws-bottom-anchored");
			    let scrollHeight = scroll.scrollHeight;
                let numOfScrolls = 0;
                scroll.scrollTo(0, 0); // Go to top of messages to load more
				let interval = setInterval(() => {
                    // If message list div gets bigger, increase scroll count
					if (scroll.scrollHeight - scrollHeight > 20) {
                        numOfScrolls += 1;
                        if (numOfScrolls >= 6){ // When scroll count gets to 6, stop
                            clearInterval(interval);
                            clearTimeout(timeout);
                            resolve();
                        }
                        else {
                            scrollHeight = scroll.scrollHeight;
                            scroll.scrollTo(0, 0); // Scroll to top again to load more
                        }
					}
                }, 50)
                // Stop after 15 seconds if scroll count still hasnt reached
                let timeout = setTimeout(() => {
                    clearInterval(interval);
                    resolve();
                }, 15000)
            })
            // Grab all links
			let aTags = document.querySelectorAll(".text-msg-content a");
            let aLinks = [];
            // For every link, check if link contains tiktok.com and add it to array
			for (let i = 0; i < aTags.length; i++) {
                if (aTags[i].href.toLowerCase().includes("tiktok.com") == false) continue;
                // If post link is not already in our collection of posts
                let push = true;
                for (let post of posts) {
                    if (post.link === aTags[i].href) push = false;
                }
                if (push) aLinks.push(aTags[i].href);
            }
			resolve(aLinks); // Return list of links
		})
    }, req.session.content.posts)
    
    let lastPost = null;
    // Upload the last post that was obtained
    let uploadPost = async () => {
        return new Promise((resolve) => {
            MongoClient.connect(url, (err, client) => {
                if (err) throw err;
                let db = client.db("tiktok-sms-grabber");
                // Create post object based on last retrieved post
                let post = {
                    html: lastPost.html,
                    users: [
                        {
                            username: req.session.user.username,
                            rating: 0
                        },
                        {
                            username: contactUsername,
                            rating: 0
                        }
                    ],
                    link: lastPost.link,
                    date: Date.now() // TODO: update to proper timezone based on client
                }
                db.collection("Posts").insertOne(post, (err) => {
                    client.close();
                    if (err) throw err;
                    // Add new post to session
                    post._id = post._id.toString();
                    let sessionPost = {
                        id: post._id,
                        html: post.html,
                        yourRating: 0,
                        theirRating: 0,
                        comments: [],
                        link: post.link,
                        date: Date.now() // TODO: update to proper timezone based on client
                    }
                    req.session.content.posts.push(sessionPost);
                    req.session.save(() => {
                        resolve();
                    });
                })
            })
        })
    } 
    links = new Set(links);

	// For every link, go to the link
	for (let link of links) {
        let pageLoad = page.goto(link, {waitUntil: "networkidle2"});
        if (lastPost) {
            // Add last post to database while page is loading
            uploadPost();
        }
        await new Promise((resolve) => {
            pageLoad.then(() => {
                resolve();
            })
        });
        // Get the full url for the web page and split it into parts
        let embedPost = await page.evaluate(async (link) => {
            return await new Promise(async (resolve, reject) => {
                let url = window.location.href;
                let targetURL = url.split("?")[0];
                let urlParts = targetURL.split("/video/");
                let userURL = urlParts[0];
                let user = userURL.split("tiktok.com/")[1];
                let id = urlParts[1];
                // Using the split up url parts, create the embeded html
                let embedHTML = `<blockquote class="tiktok-embed" cite="${targetURL}" 
                    data-video-id="${id}" style="max-width: 605px;min-width: 325px;" > 
                    <section> <a target="_blank" title="${user}" href="${userURL}"></a> 
                    </section> </blockquote>`;
                resolve({html: embedHTML, link: link}); // Return embeded html
            })
        }, link)
        lastPost = embedPost;
    }
    
    await uploadPost(); // Upload the final obtained post (after final loop)
	return true;
}

app.listen(process.env.PORT || 3000, process.env.IP, () => {
    console.log("Server has started");
})