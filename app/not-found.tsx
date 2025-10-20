import { Button } from "@/components/ui/button";
import { ArrowLeft, Search } from "lucide-react";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-background dark:text-gray-100  flex items-center justify-center p-4">
      <div className="max-w-2xl mx-auto text-center">
        {/* 404 Illustration */}
        <div className="mb-8">
          <div className="relative">
            <div className="text-9xl font-bold text-black dark:text-gray-200 select-none">404</div>
            <div className="absolute inset-0 flex items-center justify-center">
             
            </div>
          </div>
        </div>

        {/* Error Message */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-200 mb-4">Page Not Found</h1>
          <p className="text-lg text-gray-600 dark:text-gray-400 mb-2">{"Sorry, we couldn't find the page you're looking for."}</p>
          <p className="text-sm text-gray-500 dark:text-gray-400">The page might have been moved, deleted, or you entered the wrong URL.</p>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row gap-4 justify-center mb-8">
          <Button variant="outline" size="lg" className="min-w-[160px] " href="/">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Dashboard
          </Button>
        </div>
      </div>
    </div>
  );
}
