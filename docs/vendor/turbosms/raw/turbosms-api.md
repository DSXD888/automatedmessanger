# SMS and Viber API. Message Sending Setup
URL: https://turbosms.ua/en/api.html
Author: TurboSMS

SMS and Viber API. Message Sending Setup

# HTTP API for SMS and Viber Campaigns

.

Module "message"

- Method "send"
- Method "sendmulti"
- Method "details"
- Method "status"

Module "groups"

- Method "create"
- Method "update"
- Method "delete"
- Method "list"
- Method "addPhones"
- Method "removePhones"

Module "chat"

- Method "senders"
- Method "recipients"
- Method "sessions"
- Method "messages"
- Method "send"

Module "user"

- Method "balance"

Module "file"

- Method "add"
- Method "details"

In order to work with our API, you must enable the "HTTP API" option in the API settings section under “Connection Methods.” After that, a unique authentication key will be created, which you can change at any time.

All requests must be sent to a URL of the form https://api.turbosms.ua/module/method.format, where the module/method corresponds to the API command available for invocation, and the format specifies the type of returned data. Currently, the response is only supported in JSON format. If you need a response in XML format or any other data format, please contact our support team, and we will add its support. Specifying the format is not mandatory, but we recommend always including it so that there won’t be any issues in the future if we change the default format. Currently, the default format is JSON.

Each request must include the authentication key. It can be passed in several ways:

- Request Processing Result Codes
- GET parameter token=AUTH_TOKEN;
- POST parameter token=AUTH_TOKEN if the Content-Type: application/x-www-form-urlencoded header is present;
- HTTP header Authorization: Basic AUTH_TOKEN;
- HTTP header Authorization: Bearer AUTH_TOKEN.

Data can also be sent in several ways:

- GET parameters (the total length of the URL cannot exceed 2000 characters);
- POST parameters if the Content-Type: application/x-www-form-urlencoded header is present;
- POST request containing JSON data and the Content-Type: application/json header;

Please note that you can only transmit data in one way within a single request. For example, you cannot pass part of the data as GET parameters and another part as JSON.

Important! All JSON examples in this documentation are split into multiple lines for clarity, but in real interaction with the API, all JSON data must be in a single line. If you need to insert a line break in any value, use the \n character combination.

For any valid HTTP request, the API will always return an HTTP 200 status code. The overall response structure is as follows:

```
{
   "response_code": 0,
   "response_status": "OK",
   "response_result": null
}
```

- response_code – the numeric code for the request processing result, ranging from 0 to 999;
- response_status – the status of the request processing result, representing a brief description of the outcome;
- response_result – the response data, if provided by the method. It can be null, an object, or an array of objects.

Each module includes a ping method to test the API status, which returns the following response:

```
{
   "response_code": 1,
   "response_status": "PONG",
   "response_result": null
}
```

If you receive this response, it means the API is operating correctly and can be used.

## Request Numbering

If you need a request to be executed only once, you can add the parameter sequence_id, which contains your unique request identifier. This parameter can contain up to 40 characters. If a request with the same identifier has already been executed within the last 30 days, the results of its execution will be returned, and the request will not be executed again. The response code will be FAILED_DUPLICATE_REQUEST. This parameter is not mandatory but is recommended for use when creating entity requests. Note that the request identifier is tied to a specific API method, meaning you can call another method with the same sequence_id.

## Message Module

The module allows you to manage messages, such as creating campaigns, sending them, and checking delivery statuses. Its functionality will be expanded.

### Method send

Example request URL: https://api.turbosms.ua/message/send.json

The method allows you to send SMS and Viber messages, as well as supports hybrid Viber sending (if the message is not delivered via Viber, it will automatically be sent via SMS).

General structure of the request body:

```
{
   "global_parameter_1": "value",
   "global_parameter_2": "value",
   ...
   "global_parameter_X": "value",
   "recipients": [
      "recipient_1",
      "recipient_2",
      ...
      "recipient_X"
   ],
   "group_ids": [
      "group_id_1",
      "group_id_2",
      ...
      "group_id_X"
   ],
   "viber": {
      "local_viber_parameter_1": "value",
      "local_viber_parameter_2": "value",
      ...
      "local_viber_parameter_X": "value"
   },
   "sms": {
      "local_sms_parameter_1": "value",
      "local_sms_parameter_2": "value",
      ...
      "local_sms_parameter_X": "value"
   }
}
```

Depending on the type of message you want to send, the request body should include parameters viber or sms, or both for hybrid sending. When creating a message, global parameter values are used first, but they can be overridden with local parameters if needed. For example, you can specify a global parameter text, and if both viber and sms parameters are present, its value will be used for both Viber and sms messages. If a different text value is specified in the sms parameter, it will be used for sms. Thus, if the parameter value is the same for both message types, it can be specified only in global parameters without duplicating it in local ones.

Attention!

Do not set a timeout on HTTP requests for sending messages, as our server will fully process your request upon receiving it. However, you will not receive a response with message IDs and may attempt to resend the message, resulting in duplicates of already sent messages.

### Available Parameters

| Parameter | Usage | Data Type | Required | Description |
| --- | --- | --- | --- | --- |
| sender | sms / viber | string(25) | The sender name from which the message will be sent (alpha name for SMS or sender for Viber). The sender must be activated in your account. |
| start_time | sms / viber | datetime | Deferred sending date and time, supports multiple ISO formats. The recommended format is YYYY-MM-DD HH:MM. The date should not exceed 14 days from the current moment. Do not pass this parameter if the message needs to be sent immediately. |
| start_date | sms / viber | datetime | A synonym for the start_time parameter, added for convenience. |
| text | sms / viber | string(1000) | Message text. For Viber, up to 1000 characters; for SMS, up to 1521 characters in Latin or 661 characters in Cyrillic text (10 segments). UTF-8 encoding is supported. |
| recipients | sms / viber | array | Message recipients in international format (380XXXXXXXXX). The parameter must always be passed as an array, even if there is only one recipient. No more than 5000 recipients are allowed in a single request. |
| group_ids | sms и viber | array | The IDs of the phone groups containing the recipients to whom the message will be sent. This parameter must always be provided as an array, even if there is only one group. There is no limit on the number of groups, but keep in mind that the more recipients there are in the groups, the longer it will take to process the request, which may exceed the timeouts set on both your end and ours. |
| is_flash | sms | boolean | Flag for flash messages (1 - yes, any other value or absence of this parameter - no). |
| ttl | viber | integer | Message lifespan, during which it will be delivered. If the message is not delivered within this time, it will be marked as undelivered. Specified in seconds, values between 60 and 86400 are allowed, with a default of 3600. |
| image_url | viber | string | The URL of the image that will be displayed in the message. |
| caption | viber | string(30) | Text on the button in the message. |
| action | viber | string | The URL the recipient will be redirected to upon clicking the button. |
| file_id | viber | integer | ID of the file returned by the file/add method. |
| count_clicks | viber | boolean | Click-through statistics flag (1 - statistics will be kept, any other value or absence of this parameter - no). |
| is_transactional | viber | boolean | Transactional message flag (1 - yes, any other value or absence of this parameter - no). |
| carousel | viber | array | Array with product cards carousel data, detailed description in the table below. |
| survey | viber | array | The array with survey data, it must contain at least two elements with answer options. |

The recipients or group_ids parameter—or both—must be included; any duplicate recipients will be ignored.

If no delayed sending time is specified and the created distribution has no more than 5 recipients, the messages will be sent immediately. This means you will only receive a response after these messages have been processed, which may cause some delay in receiving a response. If it is important for you to receive a response as soon as possible, specify a delayed send time, and the message will be queued and sent in a different thread. Viber messages are sent as promotional by default if the is_transactional parameter is not set.

All transactional messages sent to Ukrainian numbers must match pre-registered templates.

If no suitable template is found when sending a transactional message, it will be rejected with the code NOT_ALLOWED_MESSAGE_TRANSACTION_PATTERN. There may be situations where a template is found by our system but, for some reason, Viber does not find it on their side. In such a case, the message will be charged at the promotional rate. We strive to identify such cases so that our clients can promptly make changes to the template and get the transactional message rate.

Using the file_id parameter, you can send files to users, such as documents, invoices, and so on. To send a file, you need to pass the caption parameter together with file_id, where you can specify the file name, for example, "Invoice.pdf". This parameter can contain up to 25 Latin characters or up to 12 Cyrillic characters. The text, button, and image parameters must not be present. The following file formats are supported: .doc, .docx, .rtf, .dot, .dotx, .odt ,odf, .fodt, .txt, .info, .pdf, .xps, .pdax, .eps, .xls, .xlsx, .ods, .fods, .csv, .xlsm, .xltx. Such messages are charged at the promotional rate.

You can also use file_id to send an image or a link on a button. For an image, simply specify the file_id of the corresponding image, in which case the image_url parameter will be ignored. If the caption parameter is specified and the action parameter is missing, the file will be sent as a link on a button. Such messages are charged at the promotional rate.

Please note that in a message with a poll, the text field can contain up to 85 characters, and the answer option can contain up to 50 characters. Surveys are charged as transactional messages; the is_transactional parameter has no effect and is simply ignored. You can specify between 2 and 5 answer options.

### Product cards carousel

To send a message with a carousel of product cards, you need to pass an array of card objects, each of which contains: a title, image, caption, and URL of the main button, as well as the text and URL of an additional link.

| Parameter | Data Type | Required | Description |
| --- | --- | --- | --- |
| title | string(38) | Product card title. |
| image_url | string | URL address of the product card image. |
| file_id | integer | The id of the product card image file returned by the file/add method. |
| button_caption | string(10) | Text placed on the main button. |
| button_url | string | The URL address where the recipient of the message will be redirected when they click on the button. |
| link_caption | string(12) | Additional text displayed as a link. |
| link_url | string | The URL address where the recipient of the message will be redirected when they click on the link. |

You can use either image_url or file_id as the image; one of them must be present. The recommended image size is 215x185 pixels. A single carousel post can contain 2 to 5 product cards and is charged as an promotional message.

In response to a create message request, the server will return data with the following structure:

```
{
   "response_code": 802,
   "response_status": "SUCCESS_MESSAGE_PARTIAL_ACCEPTED",
   "response_result": [
      {
         "phone": "recipient_1",
         "response_code": 406,
         "message_id": null,
         "response_status": "NOT_ALLOWED_RECIPIENT_COUNTRY"
      },
      {
         "phone": "recipient_2",
         "response_code": 0,
         "message_id": "f83f8868-5e46-c6cf-e4fb-615e5a293754",
         "response_status": "OK"
      }
   ]
}
```

Here, the global parameters response_code and response_status contain the overall result of processing the request, and the response_result parameter returns an array of objects, each of which contains the result of processing a specific recipient from the request. The message_id parameter contains a unique identifier of the message by which you can retrieve the current delivery status. If it is impossible to send a message to that recipient, the message_id parameter will be null, and the response_code and response_status parameters will provide error information.

#### Examples of Message Sending Data

Sending an SMS, JSON POST request:

```
{
   "recipients": [
      "380678998668",
      "380503288668",
      "380638998668"
   ],
   "sms": {
      "sender": "TurboSMS",
      "text": "TurboSMS welcomes you!"
   }
}
```

The same data, GET request:

```
https://api.turbosms.ua/message/send.json?recipients[0]=380678998668&recipients[1]=380503288668&recipients[2]=380638998668&sms[sender]=TurboSMS&sms[text]=TurboSMS+welcomes+you%21&token=AUTH_TOKEN
```

Sending a Viber message:

```
{
   "recipients": [
      "380678998668",
      "380503288668",
      "380638998668"
   ],
   "viber": {
      "sender": "TurboSMS",
      "text": "TurboSMS welcomes you!"
   }
}
```

Hybrid sending of Viber:

```
{
   "recipients": [
      "380678998668",
      "380503288668",
      "380638998668"
   ],
   "group_ids": [
      "15",
      "23"
   ],
   "viber": {
      "sender": "Viber TurboSMS",
      "text": "TurboSMS welcomes you on Viber!"
   },
   "sms": {
      "sender": "TurboSMS",
      "text": "TurboSMS welcomes you on SMS!"
   }
}
```

Sending an SMS at a specified time:

```
{
   "start_time": "2020-03-08 10:00",
   "recipients": [
      "380678998668"
   ],
   "sms": {
      "sender": "TurboSMS",
      "text": "Maksym, happy birthday!"
   }
}
```

Sending a file in Viber:

```
{
   "recipients": [
      "380678998668"
   ],
   "viber": {
      "sender": "TurboSMS",
      "file_id": 12345,
      "caption": "Contract.pdf"
   }
}
```

Sending a file as a link on a button in a Viber message:

```
{
   "recipients": [
      "380678998668"
   ],
   "viber": {
      "sender": "TurboSMS",
      "text": "An invoice of 1000 hryvnias has been issued for your order №12345.",
      "file_id": 23456,
      "caption": "Download Invoice"
   }
}
```

Sending a carousel of product cards in a Viber message:

```
{
   "recipients": [
      "380678998668"
   ],
   "viber": {
      "sender": "Super FOOD",
      "text": "Only today, on your birthday, we are giving you one of the dishes you ordered most often:",
      "carousel": [
         {
           "image_url": "https://www.willcookforsmiles.com/wp-content/uploads/2025/02/Avocado-salmon-rice-bowl-in-a-bowl.jpg",
           "title": "Bowl with avocado and salmon",
           "button_caption": "I want it!",
           "button_url": "https://super-food.com/order/birthday/bowl-avocado-salmon.html",
           "link_caption": "More details",
           "link_url": "https://super-food.com/bowls/bowl-avocado-salmon.html"
         },
         {
           "file_id": 123456,
           "title": "Tempura vegetables with shrimp",
           "button_caption": "Or this!",
           "button_url": "https://super-food.com/order/birthday/tempura-vegetables-shrimps.html",
           "link_caption": "More details",
           "link_url": "https://super-food.com/tempura/tempura-vegetables-shrimps.html"
         },
         {
           "file_id": 234567,
           "title": "Dragon Roll Platter",
           "button_caption": "Definitely",
           "button_url": "https://super-food.com/order/birthday/set-dragon-rolls.html",
           "link_caption": "More details",
           "link_url": "https://super-food.com/sets/set-dragon-rolls.html"
         }
      ]
   }
}
```

Sending a Viber message with a survey:

```
{
   "recipients": [
      "380678998668",
      "380503288668",
      "380638998668"
   ],
   "group_ids": [
      "15",
      "23"
   ],
   "viber": {
      "sender": "Super Shop",
      "text": "Did you like the items sent in your last order?",
      "survey": [
         "😍 Definitely yes",
         "😊 More likely yes than no",
         "🙄 More likely not than yes",
         "😕 Definitely no",
         "🤬 This is my last order from you!"
      ]
   }
}
```

### Method sendmulti

Example request URL: https://api.turbosms.ua/message/sendmulti.json

This method allows sending multiple send requests in a single HTTP request, saving the time spent on connecting to the API for each request. In other words, calling the sendmulti method with data for 100 requests will be faster than making 100 separate send requests.

General structure of the request body:

```
{
   "unique_key_for_request_1": {request_data_1},
   "unique_key_for_request_2": {request_data_2},
   ...
   "unique_key_for_request_X": {request_data_X}
}
```

The server response will return data in the following structure:

```
{
   "response_code": 0,
   "response_status": "OK",
   "response_result": {
      "unique_key_for_request_1": {response_data_for_request_1},
      "unique_key_for_request_2": {response_data_for_request_2},
      ...
      "unique_key_for_request_X": {response_data_for_request_X}
   }
}
```

The request and response data structures are identical to those of the send method.

### Method details

Example request URL: https://api.turbosms.ua/message/details.json

This method allows retrieving details of created messages. To do so, you need to pass a list of message_id as an array.

General structure of the request body:

```
{
   "messages": [
      "2d80c1c0-5e3c-78c9-134b-2fc4fcbfa0ba",
      "f83f8868-5e46-c6cf-e4fb-615e5a293754",
      "c51f4301-5e3c-78c9-134b-d1ce1e56a9ff",
      "c51f4301-5e3c-78c9-134b-d1ce1e56afd4",
      "c51f4301-5e3c-78c9-134b-d1ce1e56a3aa"
   ]
}
```

Response structure:

```
{
   "response_code": 0,
   "response_status": "OK",
   "response_result": [
      {
         "message_id": "2d80c1c0-5e3c-78c9-134b-2fc4fcbfa0ba",
         "sms": null,
         "viber": null,
         "response_code": 414,
         "response_status": "NOT_ALLOWED_MESSAGE_ID"
      },
      {
         "message_id": "f83f8868-5e46-c6cf-e4fb-615e5a293754",
         "sms": {
            "added": "2022-01-25 12:45:32",
            "start": null,
            "sent": "2022-01-25 12:45:32",
            "updated": "2022-01-25 12:45:37",
            "sender": "TurboSMS",
            "text": "TurboSMS welcomes you to SMS!",
            "recipient": "380678998668",
            "status": "Delivered",
            "price": 0.34,
            "segments": 1,
            "ttl": 86400
         },
         "viber": {
            "added": "2022-01-25 12:45:31",
            "start": null,
            "sent": "2022-01-25 12:45:31",
            "updated": "2022-01-25 12:45:32",
            "sender": "TurboSMS",
            "text": "TurboSMS welcomes you to Viber!",
            "recipient": "380678998668",
            "message_type": "promotional",
            "status": "Rejected",
            "rejected_status": "SRVC_NOT_VIBER_USER",
            "price": 0,
            "ttl": 3600,
            "caption": "",
            "action": "",
            "file_id": 0,
            "click_time": null,
            "is_transactional": 0
         },
         "response_code": 0,
         "response_status": "OK"
      },
      {
         "message_id": "c51f4301-5e3c-78c9-134b-d1ce1e56a9ff",
         "sms": null,
         "viber": {
            "added": "2022-01-27 17:13:50",
            "start": "2022-01-28 12:00:00",
            "sent": "2022-01-28 12:00:00",
            "updated": "2022-01-28 12:00:17",
            "sender": "TurboSMS",
            "text": "Maxim, happy birthday!",
            "message_type": "transactional",
            "recipient": "380678998668",
            "status": "Read",
            "rejected_status": "",
            "price": 0.36,
            "ttl": 100,
            "caption": "",
            "action": "",
            "file_id": 0,
            "click_time": null,
            "is_transactional": 1
         },
         "response_code": 0,
         "response_status": "OK"
      },
      {
         "message_id": "c51f4301-5e3c-78c9-134b-d1ce1e56afd4",
         "sms": null,
         "viber": {
            "added": "2022-01-27 17:13:50",
            "start": "2022-01-28 12:00:00",
            "sent": "2022-01-28 12:00:00",
            "updated": "2022-01-28 12:00:17",
            "sender": "Super Shop",
            "recipient": "380678998668",
            "message_type": "carousel",
            "text": "You haven't ordered anything in a long time, we miss you and are giving you a 10% discount 🤗",
            "carousel": [
               {
                 "image_url": "https://turbosms.ua/user-files/a67/71c/91b/1545256.jpg",
                 "file_id": 13572,
                 "title": "Bowl with avocado and salmon",
                 "button_caption": "I want it!",
                 "button_url": "https://super-shop.com/cart/add/bowl-avocado-salmon.html",
                 "button_clicks": 12,
                 "link_caption": "More details",
                 "link_url": "https://super-shop.com/items/bowl-avocado-salmon.html"
                 "link_clicks": 4
               },
               {
                 "image_url": "https://turbosms.ua/user-files/4ba/fc5/91d/15223508.png",
                 "file_id": 123456,
                 "title": "Tempura vegetables with shrimp",
                 "button_caption": "Or this!",
                 "button_url": "https://super-shop.com/cart/add/birthday/tempura-vegetables-shrimps.html",
                 "button_clicks": 17,
                 "link_caption": "More details",
                 "link_url": "https://super-shop.com/items/tempura-vegetables-shrimps.html"
                 "link_clicks": 9
               },
               {
                 "image_url": "https://turbosms.ua/user-files/f46/ce1/91b/123110.jpg",
                 "file_id": 234567,
                 "title": "Dragon Roll Platter",
                 "button_caption": "Definitely",
                 "button_url": "https://super-shop.com/cart/add/birthday/set-dragon-rolls.html",
                 "button_clicks": 21,
                 "link_caption": "More details",
                 "link_url": "https://super-shop.com/items/set-dragon-rolls.html"
                 "link_clicks": 5
               }
            ],
            "status": "Read",
            "rejected_status": "",
            "price": 0.36,
            "ttl": 100,
            "caption": "",
            "action": "",
            "file_id": 0,
            "click_time": null,
            "is_transactional": 0
         },
         "response_code": 0,
         "response_status": "OK"
      },
      {
         "message_id": "c51f4301-5e3c-78c9-134b-d1ce1e56a3aa",
         "sms": null,
         "viber": {
            "added": "2022-01-27 17:13:50",
            "start": "2022-01-28 12:00:00",
            "sent": "2022-01-28 12:00:00",
            "updated": "2022-01-28 12:00:17",
            "sender": "Super Shop",
            "recipient": "380678998668",
            "text": "Did you like the items sent in your last order?",
            "message_type": "survey",
            "survey": [
               "😍 Definitely yes",
               "😊 More likely yes than no",
               "🙄 More likely not than yes",
               "😕 Definitely no",
               "🤬 This is my last order from you!"
            ],
            "status": "Read",
            "rejected_status": "",
            "price": 0.36,
            "ttl": 100,
            "caption": "",
            "action": "",
            "file_id": 0,
            "click_time": null,
            "is_transactional": 0
         },
         "response_code": 0,
         "response_status": "OK"
      }
   ]
}
```

The response contains two objects: sms and viber, or null if the corresponding object is not found. The parameters of these objects correspond to the parameters of the message/send and message/status methods. The start parameter contains the scheduled sending time, if specified. The segments parameter indicates the number of sms segments, which affects the final cost of the message.

### Method status

Sample call address: https://api.turbosms.ua/message/status.json

This method allows you to retrieve message delivery status information by simply passing a list of message_id as an array.

General format of the request body:

```
{
   "messages": [
      "2d80c1c0-5e3c-78c9-134b-2fc4fcbfa0ba",
      "f83f8868-5e46-c6cf-e4fb-615e5a293754",
      "c51f4301-5e3c-78c9-134b-d1ce1e56a9ff"
   ]
}
```

Response structure:

```
{
   "response_code": 0,
   "response_status": "OK",
   "response_result": [
      {
         "message_id": "2d80c1c0-5e3c-78c9-134b-2fc4fcbfa0ba",
         "response_code": 414,
         "response_status": "NOT_ALLOWED_MESSAGE_ID"
      },
      {
         "message_id": "f83f8868-5e46-c6cf-e4fb-615e5a293754",
         "response_code": 0,
         "recipient": "recipient_2",
         "sent": "2020-01-29 10:19:21",
         "updated": "2020-01-29 10:21:32",
         "status": "Read",
         "type": "viber",
         "rejected_status": "",
         "click_time": "2020-01-29 10:22:54",
         "response_status": "OK"
      },
      {
         "message_id": "c51f4301-5e3c-78c9-134b-d1ce1e56a9ff",
         "response_code": 0,
         "recipient": "recipient_3",
         "sent": null,
         "updated": "2020-01-29 18:27:34",
         "status": "Queued",
         "type": "sms",
         "response_status": "OK"
      }
   ]
}
```

The sent parameter contains the time the message was actually sent. If its value is null, it means the message is still in the queue and will be sent later. The updated parameter reflects the time when the delivery status was updated. The type parameter indicates which channel was used to send the message. For Viber messages, the click_time parameter is also returned, containing the time the button in the message was clicked, or null if the button was not clicked.

### Description of the status field values

| status | Description |
| --- | --- |
| Queued | The message is queued for processing and will be sent |
| Accepted | The message has been sent to the mobile network, but the operator’s response has not yet been processed |
| Sent | The message was sent and is awaiting delivery |
| Delivered | The message was delivered to the recipient |
| Read | The message was read by the recipient |
| Expired | The delivery period for the message has expired |
| Undelivered | Not delivered |
| Rejected | The message was rejected |
| Unknown | Unknown status |
| Failed | It was impossible to send the message |
| Cancelled | The sending was canceled and the funds were returned to the balance |

### Description of the rejected_status field values

If a Viber message could not be sent, this field will contain the reason. In the case of a successful send, this field will be an empty string.

| rejected_status | Description |
| --- | --- |
| SRVC_NOT_VIBER_USER | The recipient is not registered in Viber |
| SRVC_USER_BLOCKED | The recipient blocked the sender or all business messages |
| SRVC_NO_SUITABLE_DEVICE | The recipient's Viber account does not support receiving business messages |

## Groups Module

The module allows you to work with groups of recipient numbers to which you can send bulk messages

### Method create

Example request URL: https://api.turbosms.ua/groups/create.json

This method creates a new group of recipient phone numbers. You must specify the group name (up to 100 characters) in the request. In response, you will receive the group’s id, which you must use in subsequent operations.

Example requests:

```
{
   "name": "Clients Kyiv"
}
```

Example response:

```
{
   "response_code": 0,
   "response_status": "OK",
   "response_result": {
      "id": 15,
      "name": "Clients Kyiv",
      "phones_count": 0,
      "added": "2026-02-26 12:00:00",
      "updated": "2026-02-26 12:00:00"
   }
}
```

### Description of the Response Parameters

| Parameter | Description |
| --- | --- |
| id | Group unique identifier |
| name | Group name |
| phones_count | Number of phone numbers in the group |
| added | Date and time the group was created |
| updated | Date and time of the last update to the group's data |

### Method update

Example request URL: https://api.turbosms.ua/groups/update.json

This method updates the settings of an existing group. The group_id parameter is required; currently, only the group name can be changed.

Example requests:

```
{
   "group_id": 15,
   "name": "VIP clients"
}
```

Example response:

```
{
   "response_code": 0,
   "response_status": "OK",
   "response_result": null
}
```

### Method delete

Example request URL: https://api.turbosms.ua/groups/delete.json

This method deletes a group of recipients. In the group_id parameter, you must provide the group’s id, which was obtained when calling the groups/create method.

Example requests:

```
{
   "group_id": 15
}
```

Example response:

```
{
   "response_code": 0,
   "response_status": "OK",
   "response_result": null
}
```

### Method list

Example request URL: https://api.turbosms.ua/groups/list.json

This method returns an array of objects containing user group data. If the request body is empty, data for all existing groups will be returned. If you pass a group’s id in the group_id parameter or its name in the name parameter, only data for the specified group will be returned. Please note that this method does not support pagination parameters. The structure of the objects in the response is identical to the response structure of the groups/create method. If you pass the with_phones parameter in the request, you will also receive an array of phone numbers in the group objects.

Example requests:

```
{
   "group_id": 15
}

{
   "name": "Clients Odesa",
   "with_phones": 1
}
```

Example response:

```
{
   "response_code": 0,
   "response_status": "OK",
   "response_result": [
      {
         "id": 23,
         "name": "Clients Odesa",
         "phones_count": 3,
         "added": "2026-02-27 13:24:41",
         "updated": "2026-02-29 19:32:28",
         "phones": [
            "380931234567",
            "380961234567",
            "380971234567"
         ]
      }
   ]
}
```

Example response (groups list):

```
{
   "response_code": 0,
   "response_status": "OK",
   "response_result": [
      {
         "id": 15,
         "name": "VIP clients",
         "phones_count": 120,
         "added": "2026-02-26 12:00:00",
         "updated": "2026-02-27 09:40:00"
      },
      {
         "id": 23,
         "name": "Clients Odesa",
         "phones_count": 3,
         "added": "2026-02-27 13:24:41",
         "updated": "2026-02-29 19:32:28"
      },
      {
         "id": 27,
         "name": "Clients Harkiv",
         "phones_count": 83,
         "added": "2026-02-28 10:12:54",
         "updated": "2026-03-01 17:51:14"
      }
   ]
}
```

### Metod addPhones

Example request URL: https://api.turbosms.ua/groups/addPhones.json

This method adds the phone numbers passed as an array to the group specified in the group_id parameter. In response, you will receive a brief summary in the summary parameter, which will include counters for the total number of phone numbers, as well as the number of successfully and unsuccessfully processed phone numbers, and an array of objects describing errors in the errors parameter. If all numbers are processed successfully, failed will be zero, and errors will be an empty array. The response code for the request will be SUCCESS_PROCESSEDB or SUCCESS_PARTIAL_PROCESSED, depending on whether all the submitted numbers were successfully processed.

Example requests:

```
{
   "group_id": 15,
   "phones": [
      "380000000000",
      "380501234567",
      "380661234567",
      "380671234567",
      "380751234567",
      "380771234567",
      "380931234567",
      "380961234567",
      "380971234567",
      "380991234567"
   ]
}
```

Example response:

```
{
   "response_code": 805,
   "response_status": "SUCCESS_PARTIAL_PROCESSED",
   "response_result": {
      "summary": {
         "group_id": 15,
         "processed": 10,
         "added": 8,
         "failed": 2
      },
      "errors": [
         {
            "phone": "380000000000",
            "response_code": 305,
            "response_status": "INVALID_PHONE"
         },
         {
            "phone": "380961234567",
            "response_code": 433,
            "response_status": "NOT_ALLOWED_GROUP_PHONE_DUPLICATE"
         }
      ]
   }
}
```

### Method removePhones

Example request URL: https://api.turbosms.ua/groups/removePhones.json

This method removes the phone numbers, passed as an array, from the group specified in the group_id parameter. The response is identical to that of the groups/addPhones method.

Example requests:

```
{
   "group_id": 15,
   "phones": [
      "380000000000",
      "380661234567",
      "380638998668",
      "380991234567"
   ]
}
```

Example response:

```
{
   "response_code": 805,
   "response_status": "SUCCESS_PARTIAL_PROCESSED",
   "response_result": {
      "summary": {
         "group_id": 15,
         "processed": 4,
         "removed": 2,
         "failed": 2
      },
      "errors": [
         {
            "phone": "380000000000",
            "response_code": 305,
            "response_status": "INVALID_PHONE"
         },
         {
            "phone": "380638998668",
            "response_code": 432,
            "response_status": "NOT_ALLOWED_GROUP_PHONE"
         }
      ]
   }
}
```

## Chat Module

This module provides functionality for working with Viber chats.

### Method senders

Sample call address: https://api.turbosms.ua/chat/senders.json

This method returns an array of objects with the user's sender data. If the request body is empty, data for all senders that have ever been active will be returned. If you pass the sender ID to sender_id or its name to sender, only data for the specified sender will be returned.

Response structure:

```
{
   "response_code": 0,
   "response_status": "OK",
   "response_result": [
      {
         "id": 1,
         "name": "TurboSMS",
         "status": "OK",
         "logo_url": "/user-files/viber-logo/0e1/ed0/eb7/5bed39ee1c676789700607.png",
         "start_date": "2020-01-01",
         "reserve": 8400,
         "spent": 1234.56,
         "balance": 7165.44,
         "paid_date": "2023-12-01",
         "2way": 1,
         "recipients": 34567,
         "unread_messages": 7,
         "last_message_date": "2022-10-01 15:34:18"
      },
      {
         "id": 2,
         "name": "Mobibon",
         "status": "OK",
         "logo_url": "/user-files/viber-logo/fc4/163/53a/7c193960f07a63ce553dbd6235bc0a80.png",
         "start_date": "2020-01-01",
         "reserve": 8400,
         "spent": 2345.67,
         "balance": 6054.33,
         "paid_date": "2099-01-01",
         "2way": 0,
         "recipients": 0,
         "unread_messages": 0,
         "last_message_date": ""
      }
   ]
}
```

### Description of the Response Parameters

| Parameter | Description |
| --- | --- |
| id | The sender's ID, required for other methods |
| name | The sender's name |
| status | The sender’s status (ok – active, frozen – not active) |
| logo_url | The path to the sender's logo in our domain |
| start_date | The date the sender began operating |
| reserve | The amount reserved for the sender’s use in subsequent months |
| spent | The amount spent by the sender in the current calendar month |
| balance | The amount available on the sender’s balance for sending messages |
| paid_date | The date through which the sender is already paid |
| 2way | Support for two-way messaging (1 – yes, 0 – no) |
| recipients | The number of recipients (only for 2way senders) |
| unread_messages | The number of unread incoming messages (only for 2way senders) |
| last_message_date | The date and time of the last message in the chat (only for 2way senders) |

### Method recipients

Example request URL: https://api.turbosms.ua/chat/recipients.json

This method returns an array of the sender's recipients. The sender can be specified either using the sender_id parameter with its ID or using the sender parameter with its name. Since there may be many recipients, there is an option to select a limited number of records with pagination support. Use the page parameter to pass the page number and rows for the number of records to return. By default, a set of 30 recipients is returned, with a maximum rows value of 500. Adding the new_only parameter will return only those recipients with unread messages, up to 30 per request. You can also pass an array of recipients whose data you want to receive in the recipients parameter. If this parameter is missing, all recipients of the passed sender will be returned.

Example requests:

```
{
   "sender_id": 1,
   "page": 10,
   "rows": 50
}

{
   "sender": "TurboSMS",
   "new_only": 1
}
```

Example response:

```
{
   "response_code": 0,
   "response_status": "OK",
   "response_result": [
      {
         "chat_id": 1234,
         "number": "380501234567",
         "contact_id": 2345,
         "name": "Vasiliy Pupkin",
         "total_messages": 123,
         "unread_messages": 3,
         "last_message_date": "2022-10-03 12:51:38"
      },
      {
         "chat_id": 2345,
         "number": "380672345678",
         "contact_id": 0,
         "name": "",
         "total_messages": 7,
         "unread_messages": 0,
         "last_message_date": "2022-10-02 16:14:41"
      }
   ]
}
```

### Description of Response Parameter Values

| Parameter | Description |
| --- | --- |
| chat_id | ID of the chat containing correspondence with the recipient |
| number | The recipient's phone number in international format |
| contact_id | ID of the contact card in the contact book, if found |
| name | First and last name in the contact card, if available and filled in |
| total_messages | Total number of messages in the chat (incoming and outgoing, sent by any method) |
| unread_messages | Number of unread incoming messages |
| last_message_date | Date and time of the last message in the chat |

### Method sessions

Example request URL: https://api.turbosms.ua/chat/sessions.json

This method returns an array of session data. Parameters can include either the chat ID in chat_id or the session ID in session_id. As an alternative to the chat_id parameter, you can use the sender_id or sender parameters to identify the sender, as well as the array of recipients recipients, for whom you want to receive data. The method also supports pagination parameters.

Example requests:

```
{
   "chat_id": 1234,
   "rows": 10
}

{
   "session_id": 123321
}

{
   "sender": "TurboSMS",
   "recipients": [
      "380678998668",
      "380503288668",
      "380638998668"
   ]
}
```

Example response:

```
{
   "response_code": 0,
   "response_status": "OK",
   "response_result": [
      {
         "id": 123456,
         "sender_id": 1,
         "sender": "TurboSMS",
         "recipient": 380678998668,
         "chat_id": 1234,
         "price": 0.88,
         "started": "2022-10-04 11:51:29",
         "ended": null,
         "sent_messages": 16,
         "unreplied_messages": 2
      },
      {
         "id": 123321,
         "sender_id": 1,
         "sender": "TurboSMS",
         "recipient": 380678998668,
         "chat_id": 1234,
         "price": 0.88,
         "started": "2022-10-03 09:12:41",
         "ended": "2022-10-04 09:12:41",
         "sent_messages": 31,
         "unreplied_messages": 0
      }
   ]
}
```

The response includes the session ID, sender and recipient details, cost of a session in the local currency (charged from the sender's or user's balance), start and end dates and times, as well as the number of sent and consecutively unreplied session messages. If the end time is null, the session is still active and session messages can be sent within it.

### Method messages

Sample call address: https://api.turbosms.ua/chat/messages.json

This method returns an array of chat messages. To retrieve the messages of a specific chat, you can pass its ID in the chat_id parameter, or use the alternative parameters sender_id or sender to identify the sender, as well as the array of recipients recipients for whom you want to receive data. This method also supports limiting the amount of data in the response with pagination, and messages are returned sorted by the time they were added, from newest to oldest. If the new_only parameter is specified, only unread messages will be returned; in this case, the pagination parameters are ignored, and the method returns all new messages of the specified chat. Please note that all unread messages returned by this method will automatically be marked as read by the system. You can also pass a message ID in the last_message_id parameter, in which case an array of messages following that ID will be returned, sorted from oldest to newest.

Request examples:

```
{
   "chat_id": 1234,
   "page": 2,
   "rows": 15
}

{
   "chat_id": 1234,
   "last_message_id": 1000
}

{
   "chat_id": 2345,
   "new_only": 1
}

{
   "sender": "TurboSMS",
   "recipients": [
      "380678998668",
      "380503288668",
      "380638998668"
   ]
}
```

Sample response:

```
{
   "response_code": 0,
   "response_status": "OK",
   "response_result": [
      {
         "id": 1462,
         "sender_id": 1,
         "sender": "SuperShop",
         "recipient": 380678998668,
         "chat_id": 1234,
         "added": "2022-10-09 17:52:29",
         "type": "Inbox",
         "message_id": "",
         "message": "😍 Definitely yes",
         "message_type": "session",
         "status": "Read",
         "file_id": 0,
         "file_url": "",
         "file_name": "",
         "button_caption": "",
         "button_action": "",
         "replied_message_id": 1391,
         "replied_message": "Did you like the items sent in your last order?",
         "session_id": 123678
      },
      {
         "id": 1391,
         "sender_id": 1,
         "sender": "SuperShop",
         "recipient": 380678998668,
         "chat_id": 1234,
         "added": "2022-10-08 12:11:31",
         "type": "Outbox",
         "message_id": "50064123-6817-940a-892d-00c54b2bbac9",
         "message": "Did you like the items sent in your last order?",
         "message_type": "survey",
         "survey": [
            "😍 Definitely yes",
            "😊 More likely yes than no",
            "🙄 More likely not than yes",
            "😕 Definitely no",
            "🤬 This is my last order from you!"
         ],
         "status": "Read",
         "file_id": 0,
         "file_url": "",
         "file_name": "",
         "button_caption": "",
         "button_action": "",
         "replied_message_id": 0,
         "replied_message": "",
         "session_id": 0
      },
      {
         "id": 1373,
         "sender_id": 1,
         "sender": "SuperShop",
         "recipient": 380678998668,
         "chat_id": 1234,
         "added": "2022-10-03 09:18:52",
         "type": "Outbox",
         "message_id": "50064123-6817-940a-892d-ffc54b2bba51",
         "message": "Your order has been shipped, tracking number 1234567890",
         "message_type": "transactional",
         "status": "Read",
         "file_id": 0,
         "file_url": "",
         "file_name": "",
         "button_caption": "",
         "button_action": "",
         "replied_message_id": 0,
         "replied_message": "",
         "session_id": 123456
      },
      {
         "id": 1248,
         "sender_id": 1,
         "sender": "SuperShop",
         "recipient": 380678998668,
         "chat_id": 1234,
         "added": "2022-10-02 18:51:38",
         "type": "Inbox",
         "message_id": "",
         "message": "",
         "message_type": "session",
         "status": "Read",
         "file_id": 12387,
         "file_url": "https://turbosms.ua/user-files/f46/ce1/91b/123456.pdf",
         "file_name": "scan.pdf",
         "button_caption": "",
         "button_action": "",
         "replied_message_id": 1234,
         "replied_message": "The item is reserved, please download the invoice and send a scan of its payment.",
         "session_id": 123456
      },
      {
         "id": 1234,
         "sender_id": 1,
         "sender": "SuperShop",
         "recipient": 380678998668,
         "chat_id": 1234,
         "added": "2022-10-02 18:37:12",
         "type": "Outbox",
         "message_id": "50064123-6817-940a-892d-00c54b2bbac9",
         "message": "The item is reserved, please download the invoice and send a scan of its payment.",
         "message_type": "promotional",
         "status": "Read",
         "file_id": 0,
         "file_url": "",
         "file_name": "",
         "button_caption": "Download the invoice",
         "button_action": "https://turbosms.ua/user-files/f46/ce1/91b/123110.pdf",
         "replied_message_id": 0,
         "replied_message": "",
         "session_id": 0
      },
      {
         "id": 1234,
         "sender_id": 1,
         "sender": "SuperShop",
         "recipient": 380678998668,
         "chat_id": 1234,
         "added": "2022-10-01 11:57:49",
         "type": "Outbox",
         "message_id": "44064ac3-6817-940a-a97d-16c54b2b8a0f",
         "message_type": "carousel",
         "message": "You haven't ordered anything in a long time, we miss you and are giving you a 10% discount 🤗",
         "carousel": [
            {
              "image_url": "https://turbosms.ua/user-files/a67/71c/91b/1545256.jpg",
              "file_id": 13572,
              "title": "Bowl with avocado and salmon",
              "button_caption": "I want it!",
              "button_url": "https://super-shop.com/cart/add/bowl-avocado-salmon.html",
              "button_clicks": 12,
              "link_caption": "More details",
              "link_url": "https://super-shop.com/items/bowl-avocado-salmon.html",
              "link_clicks": 4
            },
            {
              "image_url": "https://turbosms.ua/user-files/4ba/fc5/91d/15223508.png",
              "file_id": 123456,
              "title": "Tempura vegetables with shrimp",
              "button_caption": "Or this!",
              "button_url": "https://super-shop.com/cart/add/birthday/tempura-vegetables-shrimps.html",
              "button_clicks": 17,
              "link_caption": "More details",
              "link_url": "https://super-shop.com/items/tempura-vegetables-shrimps.html",
              "link_clicks": 9
            },
            {
              "image_url": "https://turbosms.ua/user-files/f46/ce1/91b/123110.jpg",
              "file_id": 234567,
              "title": "Dragon Roll Platter",
              "button_caption": "Definitely",
              "button_url": "https://super-shop.com/cart/add/birthday/set-dragon-rolls.html",
              "button_clicks": 21,
              "link_caption": "More details",
              "link_url": "https://super-shop.com/items/set-dragon-rolls.html",
              "link_clicks": 5
            }
         ],
         "status": "Read",
         "file_id": 0,
         "file_url": "",
         "file_name": "",
         "button_caption": "",
         "button_action": "",
         "replied_message_id": 0,
         "replied_message": "",
         "session_id": 0
      }
   ]
}
```

### Description of the Response Parameters

| Parameter | Description |
| --- | --- |
| id | The message ID, which can be used to track status changes |
| sender_id | ID of the sender on whose behalf correspondence with this recipient is conducted |
| sender | The name of the sender on whose behalf correspondence with this recipient is conducted. |
| recipient | Recipient's phone number |
| chat_id | The ID of the chat that stores the conversation with this recipient |
| added | The date and time the message was created |
| type | The direction of message (Inbox – incoming, Outbox – outgoing) |
| message_id | ID of a message that was sent outside of a chat session (from the website or was returned by the message/send method) |
| message | The message text |
| message_type | Message type: promotional, transactional, session, carousel, survey, file |
| survey | Array of survey options |
| carousel | Array of product cards for carousel |
| status | The delivery status of the message, similar to the message/status method |
| file_id | The ID of the sent file, or 0 |
| file_url | The URL of the sent file |
| file_name | The name of the sent file |
| button_caption | The button title in a promotional message |
| button_action | The link attached to the promotional message’s button |
| replied_message_id | ID of the message to which the recipient is replying, or 0 |
| replied_message | The text of the message to which the recipient is replying |
| session_id | The session's ID, or 0 if the message is not session-based |

### Method send

Example request URL: https://api.turbosms.ua/chat/send.json

This method sends a session message to the chat specified in the chat_id parameter. As an alternative to the chat_id parameter, you can use the sender_id or sender parameters to identify the sender, as well as the phone number of the recipient in recipient to whom you want to send the message. Messages can contain either text in the message parameter or a file. The data scheme of the file can be passed in the file_data parameter, with the file_name parameter specifying the file name visible to the recipient. Alternatively, a file's URL can be provided in the file_url parameter instead of the data scheme.

Attention!

Do not set a timeout on HTTP requests for sending messages, as our server will fully process your request upon receipt. However, you will not receive a response with message IDs and may attempt to resend the message, resulting in duplicates of already sent messages.

Example requests:

```
{
   "chat_id": 1234,
   "message": "Your payment has been received. Please wait for shipping information."
}

{
   "chat_id": 1234,
   "file_name": "Presentation.pdf",
   "file_data": "data:application/pdf;base64,JVBERi0xLjMKJcTl8uXrp/Og0M....lRU9GCg=="
}
```

Example response:

```
{
   "response_code": 0,
   "response_status": "OK",
   "response_result": {
      "message_id": 17693
   }
}
```

## User Module

The module provides functionality for managing user account data.

### Method balance

Example request URL: https://api.turbosms.ua/user/balance.json

This method returns the user's account balance. The request body is empty.

Response structure:

```
{
   "response_code": 0,
   "response_status": "OK",
   "response_result": {
      "balance": 12345.67
   }
}
```

## File Module

The module provides functionality for managing user files.

### Method add

Example request URL: https://api.turbosms.ua/file/add.json

This method allows uploading a file to our server. The file can be provided either as a URL, from which it will be downloaded, or directly in the request body in the data parameter. This parameter should contain the file content in data scheme format according to RFC 2397 (details). The data scheme can include the file content either as a base64 string or in an unencoded format.

Note that when sending a request via the GET method, you may encounter a URL length limitation of 2KB. To avoid this, send the request using the POST method when including the file in the data parameter.

Example requests:

```
{
   "url": "https://turbosms.ua/files/news/http-api.png"
}
```

```
{
   "data": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABIAAAASCAYAAABWzo5XAAAAwElEQVR4AayPMQ7CMBAET/keHSV1HkWRmgegUOZHlEgUkRU8ltY6WRjkxJE2d7f2Ti7D9TZvPTRYfC7nkx1RRFgC0RxVX9B7NXu+1l0iy9/03QhiqWmaDHmfGXlP/d+NFFRVsKxV0DiO+a6HeD9fiE0VFM+sDJUzd6SfIL8JgXLGk6ogH/KbeF8QahXEIRJEFe+bqiCCyIeYkffUJ1DYNLZXZROIeAiBYq01heIrg2LfDNFHySbQfX7Ysiy7RBbQBwAA//8FpsY7AAAABklEQVQDAFVE4hfSuaVLAAAAAElFTkSuQmCC"
}
```

Response structure:

```
{
   "response_code": 0,
   "response_status": "OK",
   "response_result": {
       "id": 32895,
       "link": "https://turbosms.ua/public/4ce/14a/c31/32895.png",
       "source": "https://turbosms.ua/files/news/http-api.png",
       "size": 12555,
       "created": "2021-01-21 18:00:09"
   }
}
```

The id value can be used in Viber campaigns. The link parameter contains a public link to the file, which can be accessed directly. The source parameter indicates the original file source specified during upload. The size parameter shows the file size in bytes, and the created parameter provides the date the file was saved to our server.

It is worth noting that when a file is uploaded, it is checked for duplicates. If the file has already been uploaded previously, the details of the existing file will be returned.

Currently, the following file extensions are supported: doc, docx, rtf, dot, dotx, odt, odf, fodt, txt, pdf, xps, pdax, eps, xls, xlsx, ods, fods, csv, xlsm, xltx, jpg, jpeg, png. All these file types are supported for sending in Viber messages. Attempts to upload files with any other extensions will return the code NOT_ALLOWED_FILE_TYPE. The size of a single file cannot exceed 3MB.

### Method details

Sample call address: https://api.turbosms.ua/file/details.json

This method returns file details for the passed id.

Sample request:

```
{
   "id": 32895
}
```

The response of this method is completely identical to the response of the file adding method.

## Description of Request Processing Result Codes

| response_status | response_code | Description | Available Since |
| --- | --- | --- | --- |
| OK | 0 | The request was processed successfully. | 25.02.2020 |
| PONG | 1 | Successful result for the ping method call. | 25.02.2020 |
| REQUIRED_TOKEN | 103 | The authentication token is missing. | 25.02.2020 |
| REQUIRED_CONTENT | 104 | The request data is missing. | 25.02.2020 |
| REQUIRED_AUTH | 105 | Authentication failed, the token is incorrect. | 25.02.2020 |
| REQUIRED_ACTIVE_USER | 106 | The user is blocked. Working with the API is impossible until unblocked. | 25.02.2020 |
| REQUIRED_VIBER_SESSION | 107 | No active Viber session is found; sending a session-based message is impossible. | 27.10.2022 |
| REQUIRED_MESSAGE_SENDER | 200 | The sender parameter of the message is missing or empty. | 25.02.2020 |
| REQUIRED_MESSAGE_TEXT | 201 | The text parameter of the message is missing or empty. | 25.02.2020 |
| REQUIRED_MESSAGE_RECIPIENT | 202 | The list of message recipients is missing or empty. | 25.02.2020 |
| REQUIRED_BALANCE | 203 | There are not enough funds on the balance to create the distribution. | 25.02.2020 |
| REQUIRED_MESSAGE_BUTTON | 204 | Button parameters are missing or empty in the message where they are mandatory. | 25.02.2020 |
| REQUIRED_MESSAGE_BUTTON_CAPTION | 205 | The button text parameter is missing or empty in the message. | 25.02.2020 |
| REQUIRED_MESSAGE_BUTTON_ACTION | 206 | The URL parameter for the button click action is missing or empty. | 25.02.2020 |
| REQUIRED_POLL_ITEMS | 207 | The minimum number of answer options is missing in the survey message. | 10.09.2025 |
| REQUIRED_CAROUSEL_ITEMS | 208 | The minimum number of product cards required in the carousel message is missing. | 10.09.2025 |
| REQUIRED_CAROUSEL_IMAGE | 209 | The image of the carousel product card is missing or not recognized. | 10.09.2025 |
| INVALID_REQUEST | 300 | The request is invalid. Check its structure and data correctness. | 25.02.2020 |
| INVALID_TOKEN | 301 | The authentication token is incorrect. | 25.02.2020 |
| INVALID_MESSAGE_SENDER | 302 | The message sender is invalid. | 25.02.2020 |
| INVALID_START_TIME | 303 | The date specified for delayed message sending is invalid. | 25.02.2020 |
| INVALID_MESSAGE_TEXT | 304 | An invalid message text value was passed. This code returns if the value is not a string or if the character encoding is outside of UTF-8. | 25.02.2020 |
| INVALID_PHONE | 305 | An invalid recipient number. The system could not recognize the recipient's country and operator. | 25.02.2020 |
| INVALID_TTL | 306 | An invalid value for the ttl parameter. The value must be an integer and not be represented as a string. | 25.02.2020 |
| INVALID_MESSAGE_ID | 307 | An invalid message_id parameter value, incorrect format. | 25.02.2020 |
| INVALID_FILE_ID | 308 | An invalid id value was passed when calling the file/details method, incorrect format. | 22.01.2021 |
| INVALID_SENDER_ID | 309 | An invalid sender_id parameter value was passed when calling the chat/recipients method, incorrect format. | 27.10.2022 |
| INVALID_CHAT_ID | 310 | An invalid chat_id parameter value was passed when calling the methods of the chat module, incorrect format. | 27.10.2022 |
| INVALID_SESSION_ID | 311 | An invalid session_id parameter value was passed when calling the chat/session method, incorrect format. | 27.10.2022 |
| INVALID_PAGE | 312 | An invalid pagination page parameter value. | 27.10.2022 |
| INVALID_ROWS | 313 | An invalid pagination rows parameter value. | 27.10.2022 |
| INVALID_URL | 314 | An invalid URL value has been passed. | 10.09.2025 |
| INVALID_SEQUENCE_ID | 315 | The sequence_id parameter must be no longer than 40 characters. | 15.09.2025 |
| INVALID_NAME | 316 | Invalid value for the name parameter. | 16.03.2026 |
| INVALID_GROUP_ID | 317 | Invalid value for the group_id parameter. | 16.03.2026 |
| INVALID_PHONES | 318 | Invalid value for the phones parameter. | 16.03.2026 |
| NOT_ALLOWED_MESSAGE_SENDER | 400 | This sender is not allowed for the current user. | 25.02.2020 |
| NOT_ALLOWED_MESSAGE_SENDER_NOT_ACTIVE | 401 | The sender is allowed but not currently activated (usage in the current month is not paid, registration is incomplete, etc.). | 25.02.2020 |
| NOT_ALLOWED_MESSAGE_IMAGE | 402 | The image file type is not allowed. | 25.02.2020 |
| NOT_ALLOWED_START_TIME | 403 | An invalid date for delayed message sending (exceeds established limits). | 25.02.2020 |
| NOT_ALLOWED_NUMBER_STOPLIST | 404 | The recipient’s number is on the stop list (for sms) or the ignore list (for Viber); sending is impossible. | 25.02.2020 |
| NOT_ALLOWED_RECIPIENTS_LIMIT | 405 | An invalid number of recipients. | 25.02.2020 |
| NOT_ALLOWED_RECIPIENT_COUNTRY | 406 | An invalid recipient country. The user does not have the ability to send messages to recipients in this country enabled. To activate this option, please contact our customer support team. | 25.02.2020 |
| NOT_ALLOWED_RECIPIENT_DUPLICATE | 407 | The recipient is already present in the distribution list. Duplicates are ignored. | 25.02.2020 |
| NOT_ALLOWED_MESSAGE_BUTTON_TEXT_LENGTH | 408 | The button text is too long; no more than 30 characters are allowed. | 25.02.2020 |
| NOT_ALLOWED_MESSAGE_TTL | 409 | An invalid value for the ttl parameter (exceeds established limits). | 25.02.2020 |
| NOT_ALLOWED_MESSAGE_TRANSACTION_CONTENT | 410 | An invalid content for a transactional message. Such messages can only send text; buttons and images are not allowed. | 25.02.2020 |
| NOT_ALLOWED_MESSAGE_DATA | 411 | One of the parameters has an invalid value. Please contact our customer support team for details. | 25.02.2020 |
| NOT_ALLOWED_MESSAGE_TEXT | 412 | The text contains forbidden fragments. | 25.02.2020 |
| NOT_ALLOWED_MESSAGE_TEXT_LENGTH | 413 | The maximum allowed length for the message text has been exceeded. | 25.02.2020 |
| NOT_ALLOWED_MESSAGE_ID | 414 | The data for the message with the specified message_id is not available to the current user. | 25.02.2020 |
| NOT_ALLOWED_MESSAGE_TRANSACTION_SENDER | 415 | The sender does not support the sending of transactional messages. | 25.02.2020 |
| NOT_ALLOWED_MESSAGE_TRANSACTION_PATTERN | 416 | No template was found that matches the transmitted transactional message. | 18.12.2020 |
| NOT_ALLOWED_FILE_ID | 417 | The file with the specified id does not exist or is not available to the current user. | 22.01.2021 |
| NOT_ALLOWED_FILE_EMPTY | 418 | The specified file to upload was not found or is empty. | 22.01.2021 |
| NOT_ALLOWED_FILE_TYPE | 419 | The file type is not supported. | 22.01.2021 |
| NOT_ALLOWED_FILE_SIZE | 420 | The file size exceeds the maximum allowable size of 3MB. | 22.01.2021 |
| NOT_ALLOWED_MESSAGE_TRAFFIC_TYPE | 421 | The sender does not support sending messages of the specified type. | 03.10.2022 |
| NOT_ALLOWED_SESSION_OUTBOX_LIMIT | 422 | It is forbidden to send more than 5 session-based messages in a row without a recipient response. | 27.10.2022 |
| NOT_ALLOWED_FILE_NAME_LENGTH | 423 | The file name in the Viber message is too long; no more than 25 characters are allowed. | 27.10.2022 |
| NOT_ALLOWED_PERMISSION | 424 | An attempt was made to send a Viber message in someone else’s chat. | 24.03.2023 |
| NOT_ALLOWED_TEST_NUMBER | 425 | A Viber message from a test sender can only be sent to the number linked to the user profile. | 24.08.2024 |
| NOT_ALLOWED_TEST_MESSAGES_LIMIT | 426 | The limit for sending Viber messages from a test sender has been reached. | 24.08.2024 |
| NOT_ALLOWED_MESSAGE_DUPLICATE | 427 | An attempt to create a message that was already created within the last 90 seconds. | 12.12.2024 |
| NOT_ALLOWED_MESSAGES_NUMBER_LIMIT | 428 | The message limit for messages to the same recipient has been exceeded, up to 5 messages within 10 seconds and up to 10 messages within 60 seconds is allowed. | 30.05.2025 |
| NOT_ALLOWED_GROUP | 430 | The specified group of phone numbers was not found. | 16.03.2026 |
| NOT_ALLOWED_GROUP_NAME_DUPLICATE | 431 | You already have a group of recipient numbers with the same name. | 16.03.2026 |
| NOT_ALLOWED_GROUP_PHONE | 432 | The phone number provided was not found in the specified group of phone numbers. | 16.03.2026 |
| NOT_ALLOWED_GROUP_PHONE_DUPLICATE | 433 | The phone number you entered is already in the specified group of phone numbers. | 16.03.2026 |
| FAILED_CONVERT_RESULT2JSON | 500 | Could not convert the result data to JSON format; please contact our customer support team immediately for details. | 25.02.2020 |
| FAILED_CONVERT_RESULT2XML | 501 | Could not convert the result data to XML format; please contact our customer support team immediately for details. | 25.02.2020 |
| FAILED_PARSE_BODY | 502 | Could not parse the request body (invalid format). | 25.02.2020 |
| FAILED_SMS_SEND | 503 | Could not send the SMS message. | 25.02.2020 |
| FAILED_VIBER_SEND | 504 | Could not send the Viber message. | 25.02.2020 |
| FAILED_SAVE_IMAGE | 505 | Could not save the image. | 25.02.2020 |
| FAILED_SAVE_FILE | 506 | Could not save the file. | 22.01.2021 |
| FAILED_DUPLICATE_REQUEST | 507 | A duplicate request was detected. The results of the previous request were returned. | 15.09.2024 |
| SUCCESS_MESSAGE_ACCEPTED | 800 | Messages have been successfully created and added to the sending queue. Some messages may be subject to preliminary moderation. | 25.02.2020 |
| SUCCESS_MESSAGE_SENT | 801 | Messages have been successfully sent. | 25.02.2020 |
| SUCCESS_MESSAGE_PARTIAL_ACCEPTED | 802 | Messages were successfully created and added to the sending queue, but some recipients were not included in the distribution list. For details, see the response. | 25.02.2020 |
| SUCCESS_MESSAGE_PARTIAL_SENT | 803 | Messages have been successfully sent, but some recipients were not included in the distribution list. For details, see the response. | 25.02.2020 |
| SUCCESS_PROCESSED | 804 | The requested action has been fully completed. | 16.03.2026 |
| SUCCESS_PARTIAL_PROCESSED | 805 | The requested action has been partially completed, see the errors parameter for details. | 16.03.2026 |
| FATAL_ERROR | 999 | Request execution error. Please contact our support team for details. | 25.02.2020 |

We improve yourcommunication with the client 98% of delivered messages are read

Sign up for free

#### Ошибка

