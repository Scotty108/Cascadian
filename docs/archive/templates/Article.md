## **What can we read?**

Apple's App Store Connect API is big. *Really* big. Absolutely everything you see on the App Store Connect site is exposed through the API, including details about apps, in-app purchases, app review, customer reviews, and more.

We're only going to implement a small subset of the API here, but once you've completed all the steps here you'll know more than enough to keep on building more and more – this kind of project could be expanded so easily.

Now, when it comes to working with APIs, there are two approaches.

First, we can use **`URLSession`** and **`URLRequest`** to access specific URLs, and parse them into custom Swift types using **`Codable`**. This means having to figure out all the URL structures, and also having to define all the **`Codable`** types for the data the API sends back.

Second, we can use the Swift OpenAPI Generator. This reads in an API configuration from a provider, and converts it to Swift code for us. Apple provides all its App Store Connect API configuration, so we can literally run a couple of commands to generate all the Swift code we need.

Regardless of which option you choose, there's a whole second part where we need to wrap up our requests in a JSON Web Token (JWT) to ensure all data is transferred securely.

We'll tackle JWTs later, but first I want to talk about how we work with the API: a custom **`Codable`** implementation, or using OpenAPI?

Honestly, you probably think that OpenAPI is going to be a lot easier, but it's not what we'll be doing here, and to help you understand why I want to briefly take you through the process of creating the APIs to access App Store Connect using the Swift OpenAPI Generator.

**You do not need to follow these steps in order to complete this project.** This is just so you can see the problem with using the OpenAPI generator!

First, open a Terminal window, and run **`cd Desktop`** so you're in your desktop folder. Now run this command: **`git clone https://github.com/apple/swift-openapi-generator`**.

That will grab all the code for Swift OpenAPI Generator, which should only take a second because it's quite small.

That gets the code for the OpenAPI generator, but now we need the configuration – the description of all the endpoints and types we'll be working with.

You can get *that* from here: https://developer.apple.com/documentation/appstoreconnectapi – look for the "OpenAPI specification" link, and download it. Inside the zip file will be a file called openapi.oas.json or similar, and that describes everything the Swift OpenAPI Generator needs to be able to generate code for us to work with App Store Connect.

What I want you to do is use Finder to move that file into the swift-openapi-generator folder on your Desktop, where we put all the Git source code that we fetched a moment ago.

Finally, go back to your Terminal window and run **`cd swift-openapi-generator`** to change into the source code folder, then run this command:

```bash
swift run swift-openapi-generator generate --mode client --mode types openapi.oas.json
```

That will take a few seconds to run, mostly because it needs to check out and build all the dependencies for Swift OpenAPI Generator.

But when it finishes, you'll see two new files appear in Finder: Client.swift and Types.swift.

More importantly, the size of those two files combined is 30MB – that's 30MB of Swift code required to be able to access the App Store Connect API using OpenAPI.

You'll know that such a huge amount of Swift code is very slow to compile, but you might be thinking, "that's okay, it will be compiled once and not touched again, so it won't matter." And that's *partly* true – the problem is that even just *linking* that much compiled data (taking all the compiled Swift code and putting it into our final app binary) takes quite a few seconds even on a fast computer, which makes all that code rather annoying to use.

Now, in practice you can create a configuration file where you configure the generator to only pull out types you actually want to use, but even then it's still a lot of data.

So… we're not going to use it. Instead, we're going to build most of our networking code from scratch, using plain old **`Codable`**, so you can see exactly how it works. I say "most" because the whole JWT part requires extensive knowledge of encryption and key signing, so we'll be using an external library for that.

Anyway, that's enough chat: let's get building.

The first thing we're going to do is create a struct that handles fetching App Store Connect data using the API. This will grow over time as we add more functionality, but for now all we want to do is show that we can actually read *something*. This is the hardest part in the whole process, but once it's done the rest of the app falls into shape really quickly.

Start by making a new Swift file called ASCClient.swift, then give it this code:

```swift
struct ASCClient {
var key: String
var keyID: String
var issuerID: String
}
```

Those three strings are the identification credentials we use to access Apple's API. The first one is *definitely* extremely secret, because it grants folks the ability to read and write your App Store Connect data. The second is one is also secret, but I'm not sure how useful it is by itself. The third one might be secret or might not be, I'm not sure, but regardless we'll be treating all three as secret.

The most important method in this new struct has the job of fetching some data from the App Store Connect API, but the exact type of data being fetched will change depending on the call we make.

So, we're going to write a method called **`fetch()`** that knows how to fetch a URL and decode it to some kind of data.

```swift
privatefunc fetch<T: Decodable>(_ urlString: String,as type: T.Type)asyncthrows {
    // more code to come
}
```

**Tip:** I've marked that **`private`** because all other parts of our app won't be calling it directly.

Inside there the first thing we'll do is turn our string into a full **`URL`** instance. All of the App Store Connect APIs share the same root URL, so we'll append that to whatever is passed in:

```swift
guardlet url = URL(string: "https://api.appstoreconnect.apple.com/v1\(urlString)")else {
    fatalError("Bad URL")
}
```

Next we need to create the JSON Web Token. Again, this is a really complex piece of work, so we'll be using an external dependency. We haven't added that yet, so for now we'll use an empty string:

```swift
let jwt = ""
```

Next we need to create a **`URLRequest`** for our **`URL`**, providing the JWT as our authorization token:

```swift
var request = URLRequest(url: url)
request.setValue("Bearer \(jwt)", forHTTPHeaderField: "authorization")
```

Then we go ahead and fetch the result. I'm going to ignore the response and focus just on whatever data gets sent back:

```swift
let (result,_) =tryawait URLSession.shared.data(for: request)
```

We won't do the decoding just yet because we haven't seen the data, but we can at least fetch the data and print it as a string:

```swift
let stringResult = String(decoding: result,as: UTF8.self)
print(stringResult)
```

And that completes the method – for now, at least. We haven't filled in the JWT part yet, but we'll come back to that shortly.

Now that our app knows more or less how to fetch some kind of data, the next step is to add a new method to request our first endpoint: what are all the apps the user has?

The App Store Connect API documentation is really good – everything is documented thoroughly, and it seems to be updated very often too. If you look for the "List Apps" page, that's the one we're dealing with here: the endpoint is **`/apps`**, and there a whole bunch of extra optional data we can request.

We're not going to send any custom values in, which means this first method is straightforward – the only interesting thing is that we need to specify something for the data type we don't decode yet, so I'm going to use **`Never.self`**:

```swift
func fetchApps()asyncthrows {
let url = "/apps"tryawait fetch(url, dataType: Never.self)
}
```

That doesn't send any data back because we don't *have* anything to send back, but it should at least trigger our string printing.

Now we have a method to fetch some data, and a method to load apps. Again, it won't work because we haven't done the JWT part, but we can at least try calling it now.

Over in **`ContentView`**, first add a property to create an **`ASCClient`** instance. We don't have any values for its initializer just yet, so use empty strings like this:

```swift
let client = ASCClient(
    key: "",
    keyID: "",
    issuerID: "")
```

We can then call our new **`fetchApps()`** method in **`ContentView`** first by adding a new method there:

```swift
func load()asyncthrows {
tryawait client.fetchApps()
}
```

And then by calling that from a **`task()`** modifier:

```swift
.task {
do {
tryawait load()
    }catch {
        print(error.localizedDescription)
    }
}
```

That's the full skeleton of our initial networking code done, but there's no point running it because it's quite broken!

## **Authentication with JWT**

Despite all the work we've done so far, there are three significant problems with our project:

1. We haven't written the JWT authentication code.
2. We're passing empty credentials to the **`ASCClient`** initializer.
3. macOS blocks networking by default; we need to specifically request it.

Once we solve each of those, we should actually have something that works – or at least prints a string of some JSON we can decode.

The third problem is the easiest, because it's just a checkbox: select the top-most "ShipShape" in the Project Navigator, activate the ShipShape target, then select the Signing & Capabilities tab.

Inside there is a bunch of options, but the only one we care about is under the App Sandbox category – look for "Outgoing Connections (Client)" and check it. That's one problem down!

The second problem is the next easiest: we need to provide actual credentials to **`ASCClient`**.

**I cannot show you these credentials. They are secret to me, and you need to get your own.**

To get your own authentication details, first open [https://appstoreconnect.apple.com](https://appstoreconnect.apple.com/) in your web browser. Click the "Users and Access" button, then select the "Integrations" tab.

The first time you come to this tab you'll see a message saying you need to request access to the API. Don't worry – access is granted immediately, but they do make you read some important terms and conditions saying you will not share your API access data.

Once you have access to the API, click the Generate API Key button, give it a name like "ShipShape", then under Access select "Admin" to give this key complete access to your App Store Connect data. Finally, click Generate to make the key.

**IMPORTANT:** The key you just made is extremely secret, and must not be shared unless it's to a trusted party.

The screen should now contain three really important pieces of information, and we need to get all three of them into our app.

To make things a little easier, I've provided a small file for you to download: 

That zip file contains a single file called ReplaceMe.swift, and you'll see it has three global variables declared, two of which you need to replace. Of course, if this were a shipping app we'd ask users to enter those details by hand, but for now having fixed data is helpful.

First, the **`hardCodedPrivateKeyID`** string should be replaced with the text under "KEY ID" for your newly generated key. This should be about 10 characters, and if you hover over it you should see a "Copy Key ID" button.

Second, the **`hardCodedPrivateKeyIssuerID`** string should be replaced with the Issuer ID value you should see above the "Active" title. Press Copy next to that, and replace the string.

And third is **`hardCodedPrivateKey`**. This is hard-coded to look for a file called key.p8 in your project. To get this file, click Download next to your key, and make sure you read the big warning – you get to download this key *only once*, so make sure you put it somewhere safe.

The key you download will be a p8 file, which you should drag into your project and rename it to key.p8.

That should complete all your authentication credentials, so now we can return to the property in **`ContentView`** to replace it with this:

```swift
let client = ASCClient(
    key: hardCodedPrivateKey,
    keyID: hardCodedPrivateKeyID,
    issuerID: hardCodedPrivateKeyIssuerID
)
```

Again, if we wanted to take this app further we'd make those keys something the user entered rather than hard-coded, but it's more than enough for here.

If you press Cmd+R to build and run the app, you should now at least see an error message from the App Store Connect API: "Authentication credentials are missing or invalid."

That leads us on to the last problem, which is the trickiest one: we need to generate a valid JSON Web Token. These involve both encryption and hashing so are extremely easy to get wrong, but fortunately the Vapor team have done all the hard work for us: their JWT-Kit library contains most of the code we need to generate tokens.

So, go to the File menu and choose Add Package Dependencies, then enter the following Package URL: https://github.com/vapor/jwt-kit. Click Add Package, then click Add Package again to accept the default settings.

Next, we need to define the *payload* of our token, which contains all the details of our request. Specifically, we need to provide the issuer ID, when it was issued and when it expires, and also who the data is intended for – the name of the service where the token will be used.

Vapor's JWT-Kit framework wraps up all those pieces of data in specific types, but it's pretty straightforward.

First, create a new Swift file called **`ASCPayload`**, and give it this code:

```swift
import Foundation
import JWTKit

struct ASCPayload: JWTPayload {
var iss: IssuerClaim
var iat: IssuedAtClaim
var exp: ExpirationClaim
var aud: AudienceClaim
}
```

**Note:** Those property names are pretty obscure, but are required.

Press Cmd+B now – not because it will build (it won't!) – but it starts the process of compiling JWT-Kit, which might take a few seconds because it has various dependencies.

The build will fail because that **`JWTPayload`** protocol does two things:

1. Make our struct conform to **`Codable`**, so it can be converted to JSON for sending. This is why the property names are so specific; if you desperately wanted to change them you could add custom **`CodingKeys`**.
2. Requires a verification method that checks if a token is still valid.

That second point is what's causing the hold up here, but it's easy to resolve because our token is valid as long as it hasn't expired. So, add this to the **`ASCPayload`** struct:

```swift
func verify(using:some JWTAlgorithm)throws {
try exp.verifyNotExpired()
}
```

At this point we just have one last step to get our initial App Store Connect communication to work: we need to wrap that payload data up inside a valid JWT.

First, go back to ASCClient and add an import for JWTKit there. Next, add this new method signature to **`ASCClient`**:

```swift
privatefunc createJWT()asyncthrows -> String {
    // more code to come
}
```

**Note:** Just like **`fetch()`**, this method is marked private so it's not exposed externally.

We're going to fill that in piece by piece, starting by converting our **`key`** and **`keyID`** properties to the correct types that JWT-Kit expects:

```swift
let key =try ES256PrivateKey(pem: key)
let keyID = JWKIdentifier(string: keyID)
```

Private keys are the secret identifiers we use to create signed data. Once data has been signed it can be verified on the other end using a *public* key, which as you'll guess from its name isn't secret.

Next, we need to add that to a key collection using ECDSA mode, which is an encryption algorithm that is fast, secure, and very common:

```swift
let keyCollection = JWTKeyCollection()
await keyCollection.add(ecdsa: key, kid: keyID)
```

Next, we create a new instance of our **`ASCPayload`**, passing in all the details we need:

- The issuer ID is the one we hard-coded earlier.
- The issued at time is now.
- The expiration date is some point in the future – I'll be using 10 minutes, but it's up to you.
- The audience needs to be an array containing the exact string for the App Store Connect API.

Add this code next:

```swift
let payload = ASCPayload(
    iss: IssuerClaim(value: issuerID),
    iat: IssuedAtClaim(value: .now),
    exp: ExpirationClaim(value: .now.addingTimeInterval(600)),
    aud: AudienceClaim(value: ["appstoreconnect-v1"])
)
```

Finally, we need to sign that payload with our key collection and key ID, then send it back:

```swift
returntryawait keyCollection.sign(payload, kid: keyID)
```

That completes the JWT method, and actually completes all the networking set up code – it's a *lot*, right?

All that remains is to replace this line of code in **`fetch()`**:

```swift
let jwt = ""
```

With this:

```swift
let jwt =tryawait createJWT()
```

And that's it! I know it's taken a lot of work, but if you press Cmd+R now you should be able to build and run the project and see it actually print something meaningful into Xcode's debug log – lots of JSON representing all the apps you have on App Store Connect!

And now the real work begins…

## **Decoding App Store Connect**

Now that we have some JSON coming back, it's up to us to decode it somehow – to put it into Swift structs that store all the data we want for easy access.

Start by just looking through the JSON to see roughly how it looks:

- It's a dictionary with a top-level "data" key.
- Right at the bottom you'll also see "links" and "meta" keys. (This order could in theory change, but it doesn't actually matter.)
- Inside the "data" key contains the actual information we asked for: an array of apps.
- Each app has an "id" value, along with "attributes". These contain the most important information.
- Each app also has a "relationships" key containing links to everything else related to that app.

This format is standard across nearly all the App Store Connect APIs: a "data" key with an array of items inside, each item having "id" and "attributes" properties. Knowing this will make our life a little easier!

For now our goal is just to get something on the screen, because you're almost certainly tired of just working with JSON!

So, create a new Swift file called ASCApp.swift, and give it this code:

```swift
struct ASCApp: Decodable, Hashable, Identifiable {
var id: String
var attributes: Attributes

struct Attributes: Decodable, Hashable {
var name: String
var bundleId: String
var sku: String
    }
}
```

That's just enough data to be meaningful, but we'll be adding more shortly.

Notice how that doesn't have the **`data`** field that was present in our JSON. That exact format is present in every request we make, but mostly we only care about what's *inside* the **`data`** key, so we'll make a simple wrapper struct just for that:

```swift
struct ASCAppResponse: Decodable {
var data: [ASCApp]
}
```

Now we're going to go back to the simple **`fetch()`** method from earlier, to upgrade it so that it automatically decodes whatever type we're asking for.

Change the end of the method signature so it returns a **`T`** like this:

```swift
asyncthrows -> T {
```

Now add this to the end of the method:

```swift
let decoder = JSONDecoder()
decoder.dateDecodingStrategy = .iso8601

returntry decoder.decode(T.self, from: result)
```

That's all it takes to make our networking code decode our first App Store Connect type, so now we can return to the **`fetchApps()`** method to use it. This needs to return an array of **`ASCApp`**, which it can find in the **`data`** property of **`ASCAppResponse`**, like this:

```swift
func fetchApps()asyncthrows -> [ASCApp] {
let url = "/apps"let response =tryawait fetch(url,as: ASCAppResponse.self)
return response.data
}
```

We can then plumb that through to **`ContentView`**, so that we load all our apps and store it as a property in the view.

First, add the property to store all our apps:

```swift
@Stateprivatevar apps = [ASCApp]()
```

Then change the **`load()`** method so that it stores the result of **`fetchApps()`** in there:

```swift
func load()asyncthrows {
var fetchedApps =tryawait client.fetchApps()
    apps = fetchedApps
}
```

**Note:** I'm doing that in two lines intentionally – later on we'll adjust the **`fetchedApps`** array before we assign it, to avoid multiple view reloads.

Now it's time at last for a little SwiftUI code: we're going to use a **`NavigationSplitView`** to display all the apps the user has access to, alongside some placeholder views for now.

First, add a property to store whichever app the user has selected:

```swift
@Stateprivatevar selectedApp: ASCApp?
```

Now replace the default **`VStack`** with this:

```swift
NavigationSplitView {
    List(apps, selection: $selectedApp) { appinNavigationLink(app.attributes.name, value: app)
    }
} content: {
    Text("Content")
} detail: {
    Text("Detail")
}
.navigationTitle("ShipShape")
```

Make sure you leave the existing **`task()`** modifier in place, so that loading the data continues to happen.

And *now* if you run the app you can see we're getting somewhere! Like I said earlier, just getting the networking all set up correctly is by far the hardest part in the whole process, but now that's done we can start to make progress more quickly!

With a little more work, we can show our existing information on screen. By the end of the app, users will be able to select a variety of different pieces of information to view, but for now all we have is the basic app information: name, bundle ID, and SKU. So, let's start by showing them, and we'll add more as we progress.

We need somewhere to store all the different app detail sections we'll be showing, so make a new Swift file called AppSection.swift and give it this code:

```swift
enum AppSection {
case basicInformation
}
```

There's only one case right now because that's the only type of data we have. Still, it's enough that we can design a SwiftUI view to show it – press Cmd+N to make a new SwiftUI view called **`BasicInformationView`**, then give it this code:

```swift
struct BasicInformationView: View {
var app: ASCApp

var body:some View {
        Form {
            LabeledContent("Name", value: app.attributes.name)
            LabeledContent("Bundle ID", value: app.attributes.bundleId)
            LabeledContent("SKU", value: app.attributes.sku)
        }
        .formStyle(.grouped)
    }
}
```

**Tip:** You can invent a sample app in the preview if you want – it's just a plain old Swift struct.

Displaying that view takes two steps:

1. We need to fill the **`content`** view in our **`NavigationSplitView`** with a list of possible app sections, but only when an app is selected. Yes, there's only one of these right now, but we'll be adding more shortly.
2. We need to fill the **`detail`** view with our new **`BasicInformationView`**, but only when an app *and* an app section are selected.

For that first part, add a new property to **`ContentView`** to track the selected section:

```swift
@Stateprivatevar selectedSection: AppSection?
```

Then find the **`Text("Content")`** placeholder we made earlier and replace it with this:

```swift
if selectedApp != nil {
    List(selection: $selectedSection) {
        NavigationLink("Basic Information", value: AppSection.basicInformation)
    }
}else {
    Text("Select an app")
}
```

And for the second part, replace the **`Text("Detail")`** placeholder with this:

```swift
iflet selectedApp,let selectedSection {
switch selectedSection {
case .basicInformation:
        BasicInformationView(app: selectedApp)
    }
}else {
    Text("Welcome to ShipShape!")
}
```

It's not particularly elegant, but it should all work correctly – you should be able to run the app now and see it showing useful information!

## **Reading customer reviews**

There are a few pieces of App Store Connect data we can read trivially, because they are attached to the whole app. We're going to do one of them here, so you can see how it's done: reading reviews from users.

First we need to figure out what kind of JSON we're dealing with. If you recall from earlier, we know that it will have a dictionary containing a "data" key, and that key will contain an array of objects that have "id" and "attributes" properties. We don't know exactly what those attributes are just yet, but we can at least make space for them.

So, make a new Swift file called ASCCustomerReview.swift, then give it this code:

```swift
struct ASCCustomerReview: Decodable, Hashable, Identifiable {
var id: String
var attributes: Attributes

struct Attributes: Decodable, Hashable {

    }
}

struct ASCCustomerReviewResponse: Decodable {
var data: [ASCCustomerReview]
}
```

We can put those to use immediately by adding a new method to **`ASCClient`**:

```swift
func fetchReviews(for app: ASCApp)asyncthrows -> [ASCCustomerReview] {
let url = "/apps/\(app.id)/customerReviews"let response =tryawait fetch(url,as: ASCCustomerReviewResponse.self)
return response.data
}
```

Now, after we fetch those user reviews we want to attach them to our **`ASCApp`** struct, so that ultimately that one struct stores everything we need to know about a single app.

In theory that's as simple as adding an extra property to **`ASCApp`** to store the reviews once they are downloaded:

```swift
var customerReviews = [ASCCustomerReview]()
```

But if we only do that, it will stop our existing code from working – Swift will attempt to look for a **`customerReviews`** array in the JSON, which won't be there, so the decoding will fail.

So, as well as adding that property we also need to add a **`CodingKeys`** enum to **`ASCApp`**, telling Swift to decode only **`id`** and **`attributes`**:

```swift
enum CodingKeys: CodingKey {
case id, attributes
}
```

That puts most of the networking and storage in place to fetch reviews – it's not quite correct yet because we need to update the new **`Attributes`** type to contain the correct attributes for reviews, but it's enough that we can call it all.

So, head back to the **`load()`** method in **`ContentView`** and add this before the **`apps = fetchedApps`** method:

```swift
for (index, app)in fetchedApps.enumerated() {
asynclet reviews = client.fetchReviews(for: app)

    fetchedApps[index].customerReviews =tryawait reviews
}
```

Before we run that, I want to explain what it does:

- We're looping over all the apps we fetched, and fetching their reviews.
- This is done using **`async let`** because we'll be fetching other things too – they can all run in parallel.
- This is why the **`fetchedApps`** array was made as a variable, and also why we don't assign straight to the **`apps`** property.

If you run the project now you should see a lot more JSON being printed out, because our app is now fetching all reviews for all apps. Read through it a little so you can see its structure – look for **`"data"`** (in quotes) to move easily between the various pieces of JSON.

**Note:** For the avoidance of doubt, apps that don't have any customer reviews will have an empty "data" array sent back.

Hopefully you'll find an app with reviews, and can see all its attributes below: **`rating`**, **`title`**, **`body`**, **`reviewerNickname`**, **`createdDate`**, and **`territory`**. We can literally add them to the **`Attributes`** struct inside **`ASCCustomerReview`**, like this:

```swift
struct Attributes: Decodable, Hashable {
var rating: Int
var title: String
var body: String
var reviewerNickname: String
var createdDate: Date
var territory: String
}
```

Now we need to display all that in a view somewhere, and the code here is very similar to the **`BasicInformationView`** we made earlier, except now we should display something different if there are no reviews.

Create a new SwiftUI view called **`CustomerReviewsView`**, and give it this code:

```swift
struct CustomerReviewsView: View {
var app: ASCApp

var body:some View {
        Form {
if app.customerReviews.isEmpty {
                Text("No reviews")
            }else {
                ForEach(app.customerReviews) { reviewinSection(review.attributes.title) {
                        Text(review.attributes.body)
                    }
                }
            }
        }
        .formStyle(.grouped)
    }
}
```

That only uses a little of the data we have, but that's something you can return back to later. And again, you're welcome to add some sample data if you're using Xcode's previews.

To get that actually showing on the screen, we need to add a new case to **`AppSection`**:

```swift
enum AppSection {
case basicInformation, customerReviews
}
```

Plus a new **`NavigationLink`** in the content area of our **`NavigationSplitView`**:

```swift
NavigationLink("Reviews", value: AppSection.customerReviews)
```

And a new case in the detail area:

```swift
case .customerReviews:
    CustomerReviewsView(app: selectedApp)
```

Boom! We've got reviews showing now too.

## **Reading App Store data**

There are lots of other endpoints we could implement without a lot of work, but I want to tackle a more challenging one because it shows you a lot about how the App Store Connect API works.

The API we're going to look at fetches *App Store versions*, which are the specific versions of your app on the App Store – v1 for iOS, v2 for visionOS, etc. This version information is useful because it gives us access to things like app descriptions, keywords, and more, but reading it is a little trickier because it's provided in a slightly more complex format.

When we fetch the version of an app, we're going to request some other accompanying data: localization data about the app (e.g., our App Store description in English), and any app review information that was provided.

These follow the same format you've seen previously, so we can make simple versions of them. First, make a new Swift file called **`ASCVersionLocalization`** and give it this code:

```swift
struct ASCVersionLocalization: Decodable, Hashable, Identifiable {
var id: String
var attributes: Attributes

struct Attributes: Decodable, Hashable {

    }
}
```

Then make another new Swift file called **`ASCReviewDetails`**, giving it this code:

```swift
struct ASCReviewDetails: Decodable, Hashable, Identifiable {
var id: String
var attributes: Attributes

struct Attributes: Decodable, Hashable {

    }
}
```

And finally make a third new Swift file called **`ASCAppVersion`**, and give it this code:

```swift
struct ASCAppVersion: Decodable, Hashable {
var id: String
var attributes: Attributes

struct Attributes: Decodable, Hashable {

    }
}
```

So, that's one struct to store localized text from the store front, one to store app review information, and one to store other app version information.

Fetching all that is where things get more complicated, so for now we can make a simple struct to hold it all – it won't even vaguely work, but it's enough to keep us moving forward.

So, put this into your ASCAppVersion.swift file:

```swift
struct ASCAppVersionResponse: Decodable {
var data: [ASCAppVersion]

var appStoreVersionLocalizations = [ASCVersionLocalization]()
var appStoreReviewDetails = [ASCReviewDetails]()
}
```

All those structs will be created inside a single method that loads app version data, and here's where you can really see how the App Store Connect API works – we can modify the URL to request more detailed information, and it will send it to us.

Add this to **`ASCClient`** now:

```swift
func fetchVersions(of app: ASCApp)asyncthrows -> (versions: [ASCAppVersion], localizations: [ASCVersionLocalization], reviewDetails: [ASCReviewDetails]) {
let url = "/apps/\(app.id)/appStoreVersions?include=appStoreVersionLocalizations,appStoreReviewDetail"let response =tryawait fetch(url,as: ASCAppVersionResponse.self)

return (
        response.data,
        response.appStoreVersionLocalizations,
        response.appStoreReviewDetails
    )
}
```

There are two particular things I want to point out there:

1. The URL specifically asks for App Store localization and app review data.
2. We're sending back a tuple of three values to make things easier.

All three of those new arrays are going to be stored right inside our **`ASCApp`** struct, which means adding three new properties there:

```swift
var versions = [ASCAppVersion]()
var localizations = [ASCVersionLocalization]()
var reviewDetails = [ASCReviewDetails]()
```

And now we're going to put that to work straight away, which means returning to the **`load()`** method in **`ContentView`** and adding a second **`async let`** next to the previous one:

```swift
asynclet versions = client.fetchVersions(of: app)
```

We can then read out those values by adding another **`try await`** below:

```swift
let versionData =tryawait versions
fetchedApps[index].versions = versionData.versions
fetchedApps[index].localizations = versionData.localizations
fetchedApps[index].reviewDetails = versionData.reviewDetails
```

If you run the code you'll see it's quite broken now – our new fetching code isn't working at all.

But that's okay, because the point is that we can look at the JSON to see what it contains. This time I'd like you to look for a key called "included", which is where the extra data is stored. Annoyingly, it's one big, mixed jumble, so we need to unpack that very carefully.

**`Codable`** wants each piece of data to be decoded to a single type. So, we're going to use an enum with cases that have associated values, so every type decodes to variations inside a single type.

Create a new file called ASCIncludedData.swift and give it this code:

```swift
enum ASCIncludedData: Decodable {
case versionLocalization(ASCVersionLocalization)
case reviewDetails(ASCReviewDetails)
}
```

We need to decode each item to one of those, but the only way we can distinguish which is which is by using the "type" string in the JSON. So, we need to add a coding key for that one thing – put this inside **`ASCIncludedData`**:

```swift
enum CodingKeys: CodingKey {
case type
}
```

And now we can add a custom initializer there too, which will examine that **`type`** string and pass the decoder onto either **`ASCVersionLocalization`** or **`ASCReviewDetails`**:

```swift
init(from decoder: Decoder)throws {
let container =try decoder.container(keyedBy: CodingKeys.self)
let type =try container.decode(String.self, forKey: .type)

switch type {
case "appStoreVersionLocalizations":
tryself = .versionLocalization(ASCVersionLocalization(from: decoder))
case "appStoreReviewDetails":
tryself = .reviewDetails(ASCReviewDetails(from: decoder))
default:
        fatalError("Unsupported included type: \(type)")
    }
}
```

That's enough to decode the heterogenous array correctly, but we still have a second job: once the array has been loaded, we need to filter each item into one of the two arrays in **`ASCAppVersionResponse`**.

That means decoding the **`data`** and **`included`** keys in **`ASCAppVersionResponse`**:

```swift
enum CodingKeys: CodingKey {
case data, included
}
```

Then adding an initializer there too, which is where we sort the items appropriately:

```swift
init(from decoder: any Decoder)throws {
let container =try decoder.container(keyedBy: CodingKeys.self)
self.data =try container.decode([ASCAppVersion].self, forKey: .data)

iflet includedData =try container.decodeIfPresent([ASCIncludedData].self, forKey: .included) {
for itemin includedData {
switch item {
case .versionLocalization(let value):
                appStoreVersionLocalizations.append(value)
case .reviewDetails(let value):
                appStoreReviewDetails.append(value)
            }
        }
    }
}
```

That should make it all build again, which means we can look at the JSON that's coming back and fill in all the empty **`attributes`** properties we made a few minutes ago:

First, for **`ASCVersionLocalization`**:

```swift
struct Attributes: Decodable, Hashable {
var description: String
var locale: String
var keywords: String
}
```

Second, for **`ASCReviewDetails`**:

```swift
struct Attributes: Decodable, Hashable {
var contactFirstName: String?
var contactLastName: String?
var contactPhone: String?
var contactEmail: String?
var notes: String?
}
```

And finally for **`ASCAppVersion`**:

```swift
struct Attributes: Decodable, Hashable {
var platform: String
var versionString: String
var appStoreState: String
var copyright: String
var createdDate: Date
}
```

That's the last of the model data, so all that remains is to create new SwiftUI views to show all that data, starting with a new SwiftUI view called **`VersionsView`**:

```swift
struct VersionsView: View {
var app: ASCApp

var body:some View {
        Form {
iflet version = app.versions.first {
                LabeledContent("Platform", value: version.attributes.platform)
                LabeledContent("Version", value: version.attributes.versionString)
                LabeledContent("Copyright", value: version.attributes.copyright)
                LabeledContent("State", value: version.attributes.appStoreState)
            }else {
                Text("No versions.")
            }
        }
        .formStyle(.grouped)
    }
}
```

Then another new SwiftUI view called **`AppReviewView`**, this time being careful with the optionals:

```swift
struct AppReviewView: View {
var app: ASCApp

var body:some View {
        Form {
iflet reviewDetails = app.reviewDetails.first {
                LabeledContent("First Name", value: reviewDetails.attributes.contactFirstName ?? "N/A")
                LabeledContent("Last Name", value: reviewDetails.attributes.contactLastName ?? "N/A")
                LabeledContent("Notes", value: reviewDetails.attributes.notes ?? "No notes.")
            }else {
                Text("No app review details.")
            }
        }
        .formStyle(.grouped)
    }
}
```

And finally, a third new SwiftUI view called **`LocalizationsView`**:

```swift
struct LocalizationsView: View {
var app: ASCApp

var body:some View {
        Form {
iflet localization = app.localizations.first {
                LabeledContent("Description", value: localization.attributes.description)
                LabeledContent("Keywords", value: localization.attributes.keywords)
                LabeledContent("Locale", value: localization.attributes.locale)
            }else {
                Text("No localizations.")
            }
        }
        .formStyle(.grouped)
    }
}
```

Getting to those three means adding new **`AppSection`** cases for it:

```swift
enum AppSection {
case basicInformation, customerReviews, versions, appReview, localizations
}
```

As well as new **`NavigationLink`** in the content part of our **`NavigationSplitView`**:

```swift
NavigationLink("Versions", value: AppSection.versions)
NavigationLink("App review", value: AppSection.appReview)
NavigationLink("Localizations", value: AppSection.localizations)
```

And also three new cases in the detail part of the Split View:

```swift
case .versions:
    VersionsView(app: selectedApp)
case .localizations:
    LocalizationsView(app: selectedApp)
case .appReview:
    AppReviewView(app: selectedApp)
```

That completes the project!

Go ahead and press Cmd+R one last time so you can try it all out – you'll see all your apps listed, and can then navigate through App Review, Basic Information, Localizations, Reviews, and Versions for each app.

There is *so much more* this app could do. Yes, you could (and should!) do some work on the styling, because **`LabeledContent`** isn't really a great choice for things like the app's description, but you could also read any other parts of the API, you could *write* other parts of the API so your app sends changes back to App Store Connect, and of course you could publish the whole thing on the App Store – this is the kind of app every iOS developer would benefit from!
