# Receiving SMS Statuses: DLR, Webhook, Callback — TurboSMS
URL: https://turbosms.ua/en/callback.html
Author: TurboSMS

Receiving SMS Statuses: DLR, Webhook, Callback — TurboSMS 

 

 

 

 

 

We use cookies to improve your experience on our website. By continuing to browse the site, you agree to the use of cookies. More info

OK

# Webhooks

Set up webhooks to promptly receive data from us when any events occur, for example, when receiving delivery statuses or an incoming Viber message. You don't need to constantly request these data via the API.

You can enable webhooks in the " Webhooks" section, where you can configure a webhook for the required event.

When adding a webhook, you need to specify the callback URL where we will send the data, select the required events that will trigger the webhook, enter a security secret key to prevent request forgery, add a login and password for HTTP Basic authentication (if needed), and choose the data format. Currently, the JSON and FORM DATA formats are supported, sent via the POST method.

The following data will be sent with each webhook:

- id  the unique identifier of the event that occurred;
- signature  the SHA1 hash of a string consisting of the security secret key and id;
- type  the event type;
- date  the date and time when the event occurred;
- try  the sequential number of the attempt to send data in case previous attempts were unsuccessful;
- data  an array or object (depending on the chosen data format) containing the event data;

When sending a request to the callback URL, your server must return an HTTP status code of 200, indicating that the request was processed successfully. All other codes will be interpreted by our service as failed requests, so we will attempt to resend it. Resend attempts will occur after 1 minute, then after 3 minutes, then after 5, 10, 15, 20, 30, 60, and 120 minutes. In other words, we will try to deliver your webhook data for 4.5 hours in total, after which further resend attempts will stop. You can also manually trigger a webhook resend in the user panel.

Supported event types:

| Type | Event |
| --- | --- |
| DLR_SMS_API | receiving the delivery status of an SMS sent via HTTP API |
| DLR_SMS_SQL | receiving the delivery status of an SMS sent via SQL |
| DLR_SMS_SOAP | receiving the delivery status of an SMS sent via SOAP |
| DLR_SMS_SMPP | receiving the delivery status of an SMS sent via SMPP |
| DLR_VIBER_API | receiving the delivery status of a Viber message sent via HTTP API |
| DLR_VIBER_SESSION | receiving the delivery status of a session-based Viber message |
| INBOX_VIBER_SESSION | receiving an incoming Viber message |
| VIBER_BUTTON_CLICK | a click on a button in a Viber message |

The following is a description of the data structures that will be sent in the data parameter depending on the event type.

### Receiving the delivery status of an SMS sent via HTTP API

| Field | Purpose |
| --- | --- |
| message_id | The unique identifier of the message received upon sending |
| status | The delivery status |
| sent_date | The date and time the message was sent in the YYYY-MM-DD HH:MM:SS format according to the Kyiv time zone |
| dlr_date | The date and time the DLR was generated in the YYYY-MM-DD HH:MM:SS format according to the Kyiv time zone |
| error_code | The operator error code |

Usually, error codes conform to the SMPP specification, but there can be exceptions when an operator has its own set of error codes. In such a case, we may additionally request the meaning of a specific code. If you are interested in the reason for a message rejection, please contact us and we will send a clarifying request to the operator.

### Description of the status field values

| Value | Description |
| --- | --- |
| DELIVRD | The message was delivered to the recipient |
| READ | The message was read by the recipient (only for Viber messages) |
| EXPIRED | The delivery period for the message has expired |
| UNDELIV | Not delivered |
| REJECTD | The message was rejected |

### Receiving the delivery status of an SMS sent via SQL

| Field | Purpose |
| --- | --- |
| id | The value of the id field in the user's table |
| status | The delivery status |
| sent_date | The date and time the message was sent in the YYYY-MM-DD HH:MM:SS format according to the Kyiv time zone |
| dlr_date | The date and time the DLR was generated in the YYYY-MM-DD HH:MM:SS format according to the Kyiv time zone |
| error_code | The operator error code |

### Getting the Delivery Status of SMS Sent via SOAP

| Field | Description |
| --- | --- |
| message_id | Unique message ID obtained during sending |
| status | Delivery status |
| sent_date | Message sending date and time in the format YYYY-MM-DD HH:MM:SS according to Kyiv timezone |
| dlr_date | DLR generation date and time in the format YYYY-MM-DD HH:MM:SS according to Kyiv timezone |
| error_code | Operator error code |

### Getting the Delivery Status of SMS Sent via SMPP

| Field | Description |
| --- | --- |
| message_id | Unique message ID obtained during sending |
| status | Delivery status |
| sent_date | Message sending date and time in the format YYYY-MM-DD HH:MM:SS according to Kyiv timezone |
| dlr_date | DLR generation date and time in the format YYYY-MM-DD HH:MM:SS according to Kyiv timezone |
| error_code | Operator error code |

### Getting the Delivery Status of Viber Sent via HTTP API

| Field | Description |
| --- | --- |
| message_id | Unique message ID obtained during sending |
| status | Delivery status |
| sent_date | Message sending date and time in the format YYYY-MM-DD HH:MM:SS according to Kyiv timezone |
| dlr_date | DLR generation date and time in the format YYYY-MM-DD HH:MM:SS according to Kyiv timezone |
| channel | Message delivery channel: sms or viber |
| error_code | Viber error code |

### Getting the Delivery Status of Viber Session Messages

| Field | Description |
| --- | --- |
| message_id | Unique message ID obtained during sending |
| status | Delivery status |
| sent_date | Message sending date and time in the format YYYY-MM-DD HH:MM:SS according to Kyiv timezone |
| dlr_date | DLR generation date and time in the format YYYY-MM-DD HH:MM:SS according to Kyiv timezone |
| error_code | Viber error code |

### Receiving Incoming Viber Messages

| Field | Description |
| --- | --- |
| id | Unique message ID |
| chat_id | Chat ID where the correspondence with the customer is stored |
| session_id | Unique session ID |
| received_date | Message receipt date and time |
| sender | Sender's name |
| number | Recipient's phone number |
| message | Message text |
| file_id | ID of the sent file, or 0 |
| file_url | URL of the sent file |
| file_name | Name of the sent file |

### Click on a Button in Viber Message

| Field | Description |
| --- | --- |
| message_id | Unique message ID obtained during sending |
| sender | Sender's name |
| number | Recipient's phone number |
| message | Message text |
| click_date | Click date and time |

Please note that this event can only be generated for messages with click tracking (click-through statistics) enabled.

 

 

 

We improve yourcommunication with the client 98% of delivered messages are read

Sign up for free

 

#### Ошибка

 



