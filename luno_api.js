const http = require('https');
const { URLSearchParams } = require('url');
const BASE_URL = "api.luno.com"

const getRequest = (endpoint, data, succ, err) => {
	const parameters = new URLSearchParams(data);
	const options = {
		hostname: BASE_URL,
		port: 443,
		path: "/api/1/" + endpoint + "?" + parameters.toString(),
		method: 'GET',
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded'
		}
	}

	const req = http.request(options, (res) => {
		var data = "";
		res.on('data', (d) => {
			data += d;
		});

		res.on('end', () => {
			succ(JSON.parse(data));
		});
	});
	req.on('error', err);
	req.end();
};

const authenticatedGetRequest = (endpoint, auth, data, succ, err) => {
	const authString = Buffer.from(auth.username + ":" + auth.password).toString('base64');
	const parameters = new URLSearchParams(data);
	const options = {
		hostname: BASE_URL,
		port: 443,
		path: "/api/1/" + endpoint + "?" + parameters.toString(),
		method: 'GET',
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded',
			'Authorization': 'Basic ' + authString
		}
	}

	const req = http.request(options, (res) => {
		var data = "";
		res.on('data', (d) => {
			data += d;
		});

		res.on('end', () => {
			succ(JSON.parse(data));
		});
	});
	req.on('error', err);
	req.end();
};

const postRequest = (endpoint, auth, data, succ, err) => {
	const authString = Buffer.from(auth.username + ":" + auth.password).toString('base64');
	const parameters = new URLSearchParams(data);
	const options = {
		hostname: BASE_URL,
		port: 443,
		path: "/api/1/" + endpoint + "?" + parameters.toString(),
		method: 'POST',
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded',
			'Authorization': 'Basic ' + authString
		}
	}

	const req = http.request(options, (res) => {
		var data = "";
		res.on('data', (d) => {
			data += d;
		});

		res.on('end', () => {
			succ(JSON.parse(data));
		});
	});
	req.on('error', err);
	req.end();
};

const numberToString = (num, decimals) => {
	const scaler = 10 ** decimals;
	const floored = Math.floor(num * scaler) / scaler;
	return floored.toFixed(decimals);
};

class LunoClient {
	constructor(key, secret) {
		this.auth = { username: key, password: secret };
	}

	getPendingOrders(pair) {
		return new Promise((resolve, reject) => {
			authenticatedGetRequest('listorders', this.auth, { state: "PENDING", pair, limit: 1000 }, (response) => {
				if (response.error_code)
					reject(response);
				else {
					const pendingOrders = [];
					if (response.orders) {
						for (const order of response.orders) {
							pendingOrders.push({
								id: order.order_id,
								type: order.type,
								price: parseFloat(order.limit_price),
								amount: parseFloat(order.limit_volume),
								filled: parseFloat(order.base),
								created: parseInt(order.creation_timestamp)
							});
						}
					}
					resolve(pendingOrders);
				}
			}, reject);
		});
	}

	canclePendingOrder(orderID) {
		return new Promise((resolve, reject) => {
			postRequest('stoporder', this.auth, { order_id: orderID }, (response) => {
				if (response.error_code)
					reject(response);
				else
					resolve(response);
			}, reject);
		});
	}

	getBalances() {
		return new Promise((resolve, reject) => {
			authenticatedGetRequest('balance', this.auth, {}, (response) => {
				if (response.error_code)
					reject(response);
				else {
					const balances = response.balance;
					const wallet = {};
					for (const walletBalance of balances) {
						const balance = parseFloat(walletBalance.balance);
						const reserved = parseFloat(walletBalance.reserved);
						const available = balance - reserved;
						wallet[walletBalance.asset] = { balance, reserved, available };
					}
					resolve(wallet);
				}
			}, reject);
		});
	}

	postLimitOrder(action, amount, price, assetpair, priceDecimals, volumeDecimals) {
		const data = {
			pair: assetpair,
			type: action,
			volume: numberToString(amount, volumeDecimals),
			price: numberToString(price, priceDecimals)
		};
		return new Promise((resolve, reject) => {
			postRequest('postorder', this.auth, data, (response) => {
				if (response.error_code)
					reject(response);
				else
					resolve(response);
			}, reject);
		});
	}

	getAllTickers() {
		return new Promise((resolve, reject) => {
			getRequest('tickers', {}, (response) => {
				if (response.error_code)
					reject(response);
				else
					resolve(response);
			}, reject);
		});
	}

	getTicker(pair) {
		return new Promise((resolve, reject) => {
			getRequest('ticker', { pair }, (response) => {
				if (response.error_code)
					reject(response);
				else
					resolve(response);
			}, reject);
		});
	}
};

module.exports = { LunoClient }
